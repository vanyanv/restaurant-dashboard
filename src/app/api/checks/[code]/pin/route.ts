import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { clientIp, rateLimit } from "@/lib/rate-limit"
import { findStoreByCode, loadCrewView } from "@/lib/checks/crew"
import { issueCrewPass } from "@/lib/checks/crew-session"
import { chargeWrongPin, pinTryAllowed } from "@/lib/checks/pin-guard"
import { shortName } from "@/lib/checks/data"
import { isUniqueViolation, isValidPin } from "@/lib/checks/setup"
import { dayToDb } from "@/lib/checks/time"
import { readDevice, setDeviceCookie } from "@/lib/checks/crew-device"

/**
 * Crew PIN step. Public: the store's code in the URL is the only thing that
 * names the store, and only that store's PINs work here.
 *
 * Two kinds of limit (the owner chose no lockouts):
 * - every request, per address: 20 a minute, a ceiling against a loop;
 * - WRONG PINs only, per address and per store's day (`pin-guard.ts`, where
 *   the numbers are argued). A malformed request is refused before either is
 *   charged, and a right PIN never spends anything, so someone with the
 *   poster link cannot run the crew out of tries. A store being guessed at
 *   from many addresses alerts the owner and slows every address further;
 *   it never locks the crew out.
 *
 * What the PIN buys is a signed crew pass (`crew-session.ts`) naming this
 * store, this person, this check and its day. Mark and submit accept that
 * pass and nothing else, and re-check that the person is still active at
 * this store of this account; state is the same read-only view the public
 * page shows.
 */
const PIN_LIMIT = { limit: 20, windowMs: 60_000, identifyBy: "ip" as const }

export async function POST(request: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const device = readDevice(request)
  return setDeviceCookie(await handle(request, ctx, device.id), device)
}

async function handle(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
  device: string,
): Promise<NextResponse> {
  const limited = await rateLimit(request, PIN_LIMIT)
  if (limited) return limited

  const { code } = await params
  const store = await findStoreByCode(code)
  if (!store) return NextResponse.json({ error: "This QR code is no longer in use." }, { status: 404 })

  const body = (await request.json().catch(() => null)) as { pin?: unknown } | null
  const pin = typeof body?.pin === "string" ? body.pin : ""
  if (!isValidPin(pin)) return NextResponse.json({ error: "Enter all 4 digits." }, { status: 400 })

  const ip = clientIp(request)
  if (!(await pinTryAllowed(store, ip, device))) {
    return NextResponse.json(
      { error: "Too many wrong PINs. Wait 10 minutes and try again." },
      { status: 429, headers: { "Retry-After": "600" } },
    )
  }

  const now = new Date()
  const view = await loadCrewView(store, now)
  if (!view.active) {
    return NextResponse.json({ error: "No check is open right now." }, { status: 409 })
  }

  const crew = await prisma.crewMember.findFirst({
    where: { storeId: store.id, pin, active: true, store: { accountId: store.accountId } },
    select: { id: true, firstName: true, lastName: true },
  })
  if (!crew) {
    await chargeWrongPin(store, ip, device, now)
    return NextResponse.json({ error: `That PIN isn't set up for ${store.name}.` }, { status: 401 })
  }

  // Two taps at once race the upsert; the loser's row already exists.
  await prisma.checkStart.upsert({
    where: {
      storeId_kind_businessDate_crewMemberId: {
        storeId: store.id,
        kind: view.active.kind,
        businessDate: dayToDb(view.active.day),
        crewMemberId: crew.id,
      },
    },
    create: {
      storeId: store.id,
      kind: view.active.kind,
      businessDate: dayToDb(view.active.day),
      crewMemberId: crew.id,
    },
    update: {},
  }).catch((err) => {
    if (!isUniqueViolation(err)) throw err
  })

  return NextResponse.json({
    pass: issueCrewPass({ storeId: store.id, crewMemberId: crew.id, kind: view.active.kind, day: view.active.day }),
    firstName: crew.firstName,
    name: shortName(crew.firstName, crew.lastName),
    startedAt: now.getTime(),
  })
}
