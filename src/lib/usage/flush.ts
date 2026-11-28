/**
 * Sends the in-memory usage counts to Redis: one command, at most once every
 * five minutes per server instance. The roll-up job drains the list into the
 * database (`scripts/usage-rollup.ts`).
 *
 * An instance recycled before it flushes loses at most five minutes of its own
 * counts. Redis missing, slow or failing: the counts are dropped and the
 * request that triggered the flush is untouched.
 */
import { waitUntil } from "@vercel/functions"
import { count, oldestAgeMs, takePending } from "./meter"
import { rawRedis } from "./raw-redis"

export const PENDING_KEY = "usage:pending"
export const FLUSH_AFTER_MS = 300_000
const REDIS_WAIT_MS = 800

/**
 * A preview deploy flushes after 15 seconds and logs one line per flush, so a
 * change to this file can be proved on a preview without waiting five minutes
 * or guessing. Production never logs and keeps the five minutes.
 */
const PREVIEW = process.env.VERCEL_ENV === "preview"
const flushAfterMs = PREVIEW ? 15_000 : FLUSH_AFTER_MS

let flushing = false

export async function flushNow(): Promise<void> {
  try {
    const redis = rawRedis()
    const payload = takePending()
    if (PREVIEW) console.log(`[usage] flush redis=${Boolean(redis)} rows=${payload?.rows.length ?? 0}`)
    if (!redis || !payload) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("usage flush timed out")), REDIS_WAIT_MS)
    })
    try {
      await Promise.race([redis.rpush(PENDING_KEY, JSON.stringify(payload)), late])
      count("other", "redisCommands")
      if (PREVIEW) console.log("[usage] flush sent")
    } finally {
      clearTimeout(timer)
    }
  } catch (error) {
    // Dropped. Counting never fails a request.
    if (PREVIEW) console.log(`[usage] flush dropped: ${error instanceof Error ? error.message : error}`)
  }
}

/**
 * Called as each request ends. `waitUntil` keeps the instance alive until the
 * command is sent, after the response has gone.
 */
export function maybeFlush(now = Date.now()): void {
  try {
    if (flushing || oldestAgeMs(now) <= flushAfterMs) return
    flushing = true
    const done = flushNow().finally(() => {
      flushing = false
    })
    waitUntil(done)
  } catch {
    // `waitUntil` outside a request: the flush still runs, it is only not held open.
  }
}

export function resetFlushForTest(): void {
  flushing = false
}
