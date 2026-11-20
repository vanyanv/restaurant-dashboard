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
 * - Per phone: 5 wrong PINs per 10 minutes, keyed on a random cookie the
 *   PIN page sets (`crew_dev`). Each crew phone has its own budget, so one
 *   person's typos never block a coworker on the same store Wi-Fi.
 * - Per address: 30 wrong PINs per 10 minutes. The crew share the store
 *   Wi-Fi, so this is a ceiling for the whole store network, not one person;
 *   it is what stops a guesser who throws the cookie away and takes a fresh
 *   one each try. 30 per 10 minutes is at most 4,320 a day from one address,
 *   and the store alert below fires after 50.
 * - Per store: past 50 wrong PINs in one LA business day (a busy store sees
 *   a handful), the store is plainly being guessed at. It is NOT locked:
 *   that would let one attacker sign the whole crew out, which the owner
 *   ruled out ("no lockouts"). Instead the owner gets one Needs-you alert
 *   that day, and the pace drops to 2 wrong PINs per phone and 10 per address
 *   per 10 minutes until the day turns.
 *
 * The check runs before the PIN is compared, on purpose: letting a right PIN
 * through while over budget would let an over-budget guesser keep trying for
 * free and learn the moment one works.
 */
export const PIN_WRONG_PER_DEVICE = { limit: 5, windowMs: 10 * 60_000 }
export const PIN_WRONG_PER_DEVICE_HARDENED = { limit: 2, windowMs: 10 * 60_000 }
export const PIN_WRONG_PER_IP = { limit: 30, windowMs: 10 * 60_000 }
export const PIN_WRONG_PER_IP_HARDENED = { limit: 10, windowMs: 10 * 60_000 }
export const PIN_WRONG_PER_STORE_DAY = { limit: 50, windowMs: 24 * 60 * 60_000 }

type PinStore = { id: string; name: string }

const ipKey = (ip: string) => `checks-pin-wrong:ip:${ip}`
const deviceKey = (device: string) => `checks-pin-wrong:dev:${device}`
const storeKey = (storeId: string, day: string) => `checks-pin-wrong:store:${storeId}:${day}`

/** Can this phone, on this address, try a PIN at this store right now? Charges nothing. */
export async function pinTryAllowed(
  store: PinStore,
  ip: string,
  device: string,
  now = new Date(),
): Promise<boolean> {
  const storeHot = await isOverLimitKey(storeKey(store.id, todayLA(now)), PIN_WRONG_PER_STORE_DAY)
  if (await isOverLimitKey(deviceKey(device), storeHot ? PIN_WRONG_PER_DEVICE_HARDENED : PIN_WRONG_PER_DEVICE)) {
    return false
  }
  return !(await isOverLimitKey(ipKey(ip), storeHot ? PIN_WRONG_PER_IP_HARDENED : PIN_WRONG_PER_IP))
}

/**
 * Charge one wrong PIN to the address and to the store's day. The try that
 * first takes the store past its daily budget raises the owner's alert.
 */
export async function chargeWrongPin(
  store: PinStore,
  ip: string,
  device: string,
  now = new Date(),
): Promise<void> {
  const day = todayLA(now)
  await rateLimitKey(deviceKey(device), PIN_WRONG_PER_DEVICE)
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
