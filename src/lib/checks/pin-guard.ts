import { prisma } from "@/lib/prisma"
import { isOverLimitKey, rateLimitKey } from "@/lib/rate-limit"
import { recordError } from "@/lib/monitoring/errors"
import { logger } from "@/lib/logger"
import { dayLabel, todayLA } from "./time"

/**
 * How wrong crew PINs are paced. Only WRONG PINs are counted: a malformed
 * request is refused before anything is charged, and a right PIN never
 * spends anyone's budget, so a stranger with the poster link cannot use up
 * the crew's allowance by sending junk.
 *
 * The numbers. A PIN is 4 digits, 10,000 possibilities; a store with 20 crew
 * has 20 of them live, so a blind guess hits someone about 1 time in 500.
 *
 * - Per address: 5 wrong PINs per 10 minutes. A crew shares the store Wi-Fi,
 *   and five typos in ten minutes across a whole shift is already unusual.
 *   One address then gets at most 720 guesses a day, and the expected 500
 *   needed for a first hit takes most of a day, during which the store alert
 *   below has gone off.
 * - Per store: past 50 wrong PINs in one LA business day (a busy store sees
 *   a handful), the store is plainly being guessed at from several
 *   addresses. It is NOT locked: that would let one attacker sign the whole
 *   crew out, which the owner ruled out ("no lockouts"). Instead the owner
 *   gets one Needs-you alert that day, and every address drops to 1 wrong PIN
 *   per 10 minutes, a fifth of the normal pace, until the day turns. A crew
 *   member who types their PIN right still gets straight in.
 */
export const PIN_WRONG_PER_IP = { limit: 5, windowMs: 10 * 60_000 }
export const PIN_WRONG_PER_IP_HARDENED = { limit: 1, windowMs: 10 * 60_000 }
export const PIN_WRONG_PER_STORE_DAY = { limit: 50, windowMs: 24 * 60 * 60_000 }

type PinStore = { id: string; name: string }

const ipKey = (ip: string) => `checks-pin-wrong:ip:${ip}`
const storeKey = (storeId: string, day: string) => `checks-pin-wrong:store:${storeId}:${day}`

/** Can this address try a PIN at this store right now? Charges nothing. */
export async function pinTryAllowed(store: PinStore, ip: string, now = new Date()): Promise<boolean> {
  const storeHot = await isOverLimitKey(storeKey(store.id, todayLA(now)), PIN_WRONG_PER_STORE_DAY)
  return !(await isOverLimitKey(ipKey(ip), storeHot ? PIN_WRONG_PER_IP_HARDENED : PIN_WRONG_PER_IP))
}

/**
 * Charge one wrong PIN to the address and to the store's day. The try that
 * first takes the store past its daily budget raises the owner's alert.
 */
export async function chargeWrongPin(store: PinStore, ip: string, now = new Date()): Promise<void> {
  const day = todayLA(now)
  await rateLimitKey(ipKey(ip), PIN_WRONG_PER_IP)
  const over = await rateLimitKey(storeKey(store.id, day), PIN_WRONG_PER_STORE_DAY)
  if (!over) return
  // Every try past the budget lands here; the alert's dedupe key makes the
  // first one the only one that writes.
  await raisePinGuessAlert(store, day)
}

async function raisePinGuessAlert(store: PinStore, day: string): Promise<void> {
  try {
    const res = await prisma.alert.createMany({
      data: [
        {
          storeId: store.id,
          source: "STORE_CHECK",
          target: "STORE_CHECK",
          targetId: null,
          severity: "WATCH",
          title: `${store.name} · ${PIN_WRONG_PER_STORE_DAY.limit}+ wrong crew PINs · ${dayLabel(day)}`,
          body:
            "Someone may be guessing crew PINs from the poster link. Crew who know their PIN can still sign in; " +
            "wrong tries are slowed for the rest of the day. If it keeps happening, make a new poster link on Store checks.",
          metadata: { day, kind: "pin-guessing" },
          occurredOn: new Date(`${day}T00:00:00.000Z`),
          dedupeKey: `STORE_CHECK_PIN:${store.id}:${day}`,
        },
      ],
      skipDuplicates: true,
    })
    if (res.count === 0) return
    logger.warn("[checks.pin] store passed its daily wrong-PIN budget", { storeId: store.id, day })
    await recordError({
      source: "api",
      route: "/api/checks/[code]/pin",
      method: "POST",
      status: 401,
      message: `Store ${store.id} passed ${PIN_WRONG_PER_STORE_DAY.limit} wrong crew PINs on ${day}`,
      storeId: store.id,
      metadata: { day },
    })
  } catch (err) {
    // The alert is a courtesy; a failed write must not turn a wrong PIN into a 500.
    logger.error("[checks.pin] wrong-PIN alert failed", {
      storeId: store.id,
      message: err instanceof Error ? err.message : String(err),
    })
  }
}
