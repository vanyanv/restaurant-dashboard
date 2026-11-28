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

let flushing = false

export async function flushNow(): Promise<void> {
  try {
    const redis = rawRedis()
    const payload = takePending()
    if (!redis || !payload) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("usage flush timed out")), REDIS_WAIT_MS)
    })
    try {
      await Promise.race([redis.rpush(PENDING_KEY, JSON.stringify(payload)), late])
      count("other", "redisCommands")
    } finally {
      clearTimeout(timer)
    }
  } catch {
    // Dropped. Counting never fails a request.
  }
}

/**
 * Called as each request ends. `waitUntil` keeps the instance alive until the
 * command is sent, after the response has gone.
 */
export function maybeFlush(now = Date.now()): void {
  try {
    if (flushing || oldestAgeMs(now) <= FLUSH_AFTER_MS) return
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
