import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { clientIp, isOverLimitKey, rateLimit, rateLimitKey } from "@/lib/rate-limit"
import { checkLink, findStoreByCode } from "@/lib/checks/crew"
import { readDevice, setDeviceCookie } from "@/lib/checks/crew-device"
import { maskEmail, sendPinEmail } from "@/lib/checks/email"
import { normalizeUsPhone } from "@/lib/checks/text"
import { shortName } from "@/lib/checks/data"
import { dayLabel, todayLA } from "@/lib/checks/time"
import { logger } from "@/lib/logger"

/**
 * "Forgot my PIN?" on the crew page (owner 2026-11-25). Crew type the phone
 * number Harri has for them; if it belongs to someone active at this store,
 * their PIN goes to THEIR email, never to the screen. Knowing a coworker's
 * number therefore gets you nothing but "check your email" on their behalf.
 *
 * Limits, all per LA business day:
 * - per phone (`crew_dev` cookie): 3 numbers that match nobody, then
 *   "ask your manager";
 * - per address: 10 such misses, so throwing the cookie away doesn't buy more;
 * - per crew member: 3 emails, so nobody's inbox can be flooded.
 * Every request also counts against 10 a minute per address.
 *
 * Each sent PIN raises one INFO alert for the owner (one per person per day),
 * so a reset nobody asked for is visible.
 */
const REQUEST_LIMIT = { limit: 10, windowMs: 60_000, identifyBy: "ip" as const }
const DAY_MS = 24 * 60 * 60_000
const FORGOT_MISS_PER_DEVICE = { limit: 3, windowMs: DAY_MS }
const FORGOT_MISS_PER_IP = { limit: 10, windowMs: DAY_MS }
const FORGOT_SENDS_PER_CREW = { limit: 3, windowMs: DAY_MS }

const missDeviceKey = (store: string, dev: string, day: string) => `checks-forgot-miss:dev:${store}:${dev}:${day}`
const missIpKey = (store: string, ip: string, day: string) => `checks-forgot-miss:ip:${store}:${ip}:${day}`
const sendKey = (crew: string, day: string) => `checks-forgot-send:${crew}:${day}`

export async function POST(request: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const device = readDevice(request)
  return setDeviceCookie(await handle(request, ctx, device.id), device)
}

const fail = (status: number, reason: string, error: string) => NextResponse.json({ reason, error }, { status })

async function handle(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
  device: string,
): Promise<NextResponse> {
  const limited = await rateLimit(request, REQUEST_LIMIT)
  if (limited) return limited

  const { code } = await params
  const store = await findStoreByCode(code)
  if (!store) return fail(404, "gone", "This QR code is no longer in use.")

  const body = (await request.json().catch(() => null)) as { phone?: unknown } | null
  const phone = typeof body?.phone === "string" ? normalizeUsPhone(body.phone) : null
  if (!phone) return fail(400, "format", "Type all 10 digits of your phone number.")

  const now = new Date()
  const day = todayLA(now)
  const ip = clientIp(request)
  if (
    (await isOverLimitKey(missDeviceKey(store.id, device, day), FORGOT_MISS_PER_DEVICE)) ||
    (await isOverLimitKey(missIpKey(store.id, ip, day), FORGOT_MISS_PER_IP))
  ) {
    return fail(429, "locked", "Too many tries today. Ask your manager for your PIN.")
  }

  const crew = await prisma.crewMember.findFirst({
    where: { storeId: store.id, phone, active: true, pin: { not: null }, store: { accountId: store.accountId } },
    select: { id: true, firstName: true, lastName: true, email: true, pin: true },
    orderBy: { createdAt: "asc" },
  })
  if (!crew?.pin) {
    await rateLimitKey(missDeviceKey(store.id, device, day), FORGOT_MISS_PER_DEVICE)
    await rateLimitKey(missIpKey(store.id, ip, day), FORGOT_MISS_PER_IP)
    const locked = await isOverLimitKey(missDeviceKey(store.id, device, day), FORGOT_MISS_PER_DEVICE)
    return locked
      ? fail(429, "locked", "Too many tries today. Ask your manager for your PIN.")
      : fail(404, "nomatch", `That number isn't on file for ${store.name}. Type the number Harri has for you.`)
  }

  if (!crew.email) return fail(409, "noemail", "There's no email on file for you. Ask your manager for your PIN.")
  if (await rateLimitKey(sendKey(crew.id, day), FORGOT_SENDS_PER_CREW)) {
    return fail(429, "sent", "We already sent it 3 times today. Check your email, or ask your manager.")
  }

  const sent = await sendPinEmail({
    to: crew.email,
    firstName: crew.firstName,
    storeName: store.name,
    pin: crew.pin,
    link: checkLink(code),
  })
  if (!sent.ok) {
    logger.warn("[checks.forgot-pin] email not sent", { storeId: store.id, reason: sent.reason })
    return fail(503, "send", "We couldn't send the email. Ask your manager for your PIN.")
  }

  await raiseResetAlert(store, crew.id, shortName(crew.firstName, crew.lastName), day)
  return NextResponse.json({ email: maskEmail(crew.email) })
}

async function raiseResetAlert(
  store: { id: string; name: string },
  crewId: string,
  name: string,
  day: string,
): Promise<void> {
  try {
    await prisma.alert.createMany({
      data: [
        {
          storeId: store.id,
          source: "STORE_CHECK",
          target: "STORE_CHECK",
          targetId: null,
          severity: "INFO",
          title: `${name} asked for their PIN by email · ${store.name} · ${dayLabel(day)}`,
          body:
            "Someone typed this person's phone number on the crew page and their PIN was emailed to them. " +
            "If they didn't ask, change their PIN on Store checks > Crew & PINs.",
          metadata: { day, kind: "pin-forgot", crewMemberId: crewId },
          occurredOn: new Date(`${day}T00:00:00.000Z`),
          dedupeKey: `STORE_CHECK_PIN_FORGOT:${crewId}:${day}`,
        },
      ],
      skipDuplicates: true,
    })
  } catch (err) {
    // The alert is a courtesy; the email already went.
    logger.error("[checks.forgot-pin] alert failed", {
      storeId: store.id,
      message: err instanceof Error ? err.message : String(err),
    })
  }
}
