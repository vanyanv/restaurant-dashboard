import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { rateLimit } from "@/lib/rate-limit"
import { findStoreByCode, loadCrewView } from "@/lib/checks/crew"
import { issueCrewPass } from "@/lib/checks/crew-session"
import { shortName } from "@/lib/checks/data"
import { isUniqueViolation, isValidPin } from "@/lib/checks/setup"
import { dayToDb } from "@/lib/checks/time"

/**
 * Crew PIN step. Public: the store's code in the URL is the only thing that
 * names the store, and only that store's PINs work here.
 *
 * Rate-limited per IP rather than locked out per person (the owner chose no
 * lockouts): a store's crew share one Wi-Fi, so the limit is generous.
 */
const PIN_LIMIT = { limit: 20, windowMs: 60_000, identifyBy: "ip" as const }

export async function POST(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const limited = await rateLimit(request, PIN_LIMIT)
  if (limited) return limited

  const { code } = await params
  const store = await findStoreByCode(code)
  if (!store) return NextResponse.json({ error: "This QR code is no longer in use." }, { status: 404 })

  const body = (await request.json().catch(() => null)) as { pin?: unknown } | null
  const pin = typeof body?.pin === "string" ? body.pin : ""
  if (!isValidPin(pin)) return NextResponse.json({ error: "Enter all 4 digits." }, { status: 400 })

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
