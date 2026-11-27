import { getRedis, redisWithin as within } from "@/lib/cache/redis"
import { logger } from "@/lib/logger"

/**
 * The TV's answer, kept in Redis so a check-in does not touch the database.
 *
 * Each TV checks in every 30 to 60 seconds all day. When every check-in ran a
 * query, the Neon database never went to sleep and used up the month's compute
 * on 2026-11-26. Now a check-in reads Redis, and only goes to the database when
 * something changed.
 *
 * "Something changed" is a counter per TV (`gen`). A change on the dashboard
 * adds one to it (`forgetTvs`), after the change is saved. A saved answer
 * carries the counter it was read under, and it is used only while the counter
 * still matches. The counter is read BEFORE the database, so a check-in that
 * races a change saves its answer under the old number, and the next check-in
 * reads again.
 *
 * Without Redis, or when Redis fails or is slow, every call here does nothing
 * and the check-in goes to the database the way it always did. A change saved
 * while Redis is down cannot mark the TVs; they pick it up when their saved
 * answer runs out (KEEP_S).
 */

/** A backstop for a change that does not go through `forgetTvs` (a store renamed elsewhere). */
const KEEP_S = 6 * 60 * 60
/** When the TV last checked in. The dashboard reads it for On/Off. */
const SEEN_KEEP_S = 7 * 24 * 60 * 60

const answerKey = (h: string) => `screens:tv:${h}`
const genKey = (h: string) => `screens:gen:${h}`
const seenKey = (h: string) => `screens:seen:${h}`

type Saved<T> = { gen: number; device: string | null; body: T }


function warn(what: string, err: unknown) {
  logger.warn(`[screens.cache] ${what}`, { message: err instanceof Error ? err.message : String(err) })
}

/**
 * The saved answer for this TV, if it is still good, and the counter to save a
 * new one under. Also notes that the TV checked in. `device`: a TV that now
 * says something different about itself is read again, so the new name is saved.
 */
export async function readTv<T>(tokenHash: string, device: string | null): Promise<{ hit: T | null; gen: number | null }> {
  const redis = getRedis()
  if (!redis) return { hit: null, gen: null }
  try {
    const [saved, gen] = await within(redis.mget<[Saved<T> | null, number | string | null]>(answerKey(tokenHash), genKey(tokenHash)))
    const now = Number(gen ?? 0)
    const good = saved && saved.gen === now && (!device || device === saved.device) ? saved.body : null
    return { hit: good, gen: now }
  } catch (err) {
    warn("read failed", err)
    return { hit: null, gen: null }
  }
}

/** Save the answer read under `gen`, for at most `seconds`. */
export async function saveTv<T>(tokenHash: string, gen: number | null, device: string | null, body: T, seconds = KEEP_S): Promise<void> {
  const redis = getRedis()
  if (!redis || gen === null || seconds < 1) return
  try {
    const saved: Saved<T> = { gen, device, body }
    await within(redis.set(answerKey(tokenHash), saved, { ex: Math.min(Math.floor(seconds), KEEP_S) }))
  } catch (err) {
    warn("save failed", err)
  }
}

/** Note that this TV checked in now. */
export async function noteSeen(tokenHash: string, at = Date.now()): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  try {
    await within(redis.set(seenKey(tokenHash), at, { ex: SEEN_KEEP_S }))
  } catch (err) {
    warn("seen write failed", err)
  }
}

/** When each TV last checked in, by token hash. Missing where Redis has no record. */
export async function seenAt(tokenHashes: string[]): Promise<Map<string, Date>> {
  const out = new Map<string, Date>()
  const redis = getRedis()
  if (!redis || tokenHashes.length === 0) return out
  try {
    const values = await within(redis.mget<(number | string | null)[]>(...tokenHashes.map(seenKey)))
    tokenHashes.forEach((h, i) => {
      const ms = Number(values[i])
      if (values[i] !== null && Number.isFinite(ms)) out.set(h, new Date(ms))
    })
  } catch (err) {
    warn("seen read failed", err)
  }
  return out
}

/** These TVs' saved answers are out of date. Call after the change is saved. */
export async function forgetTvs(tokenHashes: string[]): Promise<void> {
  const redis = getRedis()
  if (!redis || tokenHashes.length === 0) return
  try {
    const p = redis.pipeline()
    for (const h of new Set(tokenHashes)) p.incr(genKey(h))
    await within(p.exec())
  } catch (err) {
    // The saved answers then last until KEEP_S. Drop them outright as a second try.
    warn("forget failed", err)
    try {
      await within(redis.del(...tokenHashes.map(answerKey)))
    } catch (err2) {
      warn("drop failed", err2)
    }
  }
}
