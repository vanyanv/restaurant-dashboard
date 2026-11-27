import { getRedis, redisWithin } from "@/lib/cache/redis"
import { logger } from "@/lib/logger"

/**
 * "Nothing can happen to any check before this moment", in Redis, so the
 * half-hourly checks cron can answer without waking the database.
 *
 * The cron runs 48 times a day and most runs find nothing to do, but finding
 * that out was itself a query. Every wake keeps the Neon compute up for at least
 * 5 minutes, and those wakes were the largest part of the database bill once
 * the TVs stopped polling it (2026-11-26).
 *
 * `checkAlertAccountsDue` writes the moment when it decides to skip: the next
 * time a check window goes past due, capped at its own forced-run interval.
 * Before that moment the gate would skip again for certain, unless a checklist,
 * closed day or pause changed. Every checks action clears the key
 * (`revalidateChecks`). A change the key misses (a store edited elsewhere) waits
 * at most for the cap, the same limit the gate already accepts for an
 * un-marked closed day.
 *
 * Without Redis, or when it fails, the cron reads the database as before.
 */
const KEY = "checks:quiet-until"

function warn(what: string, err: unknown) {
  logger.warn(`[checks.quiet] ${what}`, { message: err instanceof Error ? err.message : String(err) })
}

/** True when a saved "quiet until" is still ahead of `now`. */
export async function checksQuiet(now: Date): Promise<boolean> {
  const redis = getRedis()
  if (!redis) return false
  try {
    const until = Number(await redisWithin(redis.get<number | string>(KEY)))
    return Number.isFinite(until) && until > now.getTime()
  } catch (err) {
    warn("read failed", err)
    return false
  }
}

/** Save the moment; null clears it. */
export async function setChecksQuietUntil(until: Date | null, now = new Date()): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  try {
    if (!until || until.getTime() <= now.getTime()) await redisWithin(redis.del(KEY))
    else await redisWithin(redis.set(KEY, until.getTime(), { pxat: until.getTime() }))
  } catch (err) {
    warn("write failed", err)
  }
}
