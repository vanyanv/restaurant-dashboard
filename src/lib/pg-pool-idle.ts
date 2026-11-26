/**
 * How long an unused database connection stays open, in milliseconds.
 *
 * On Vercel this is also how long every function instance is kept alive after
 * its last query: `attachDatabasePool` holds the instance (`waitUntil`) for
 * this long plus 100 ms each time a client goes back to the pool, so idle
 * clients close before the instance is frozen. node-postgres's own default is
 * 10 s, and nothing set it, so from 2026-11-20 (when the pool was first
 * attached) every call that touched the database billed about 10 s of
 * provisioned memory after it had answered. Account function GB-hours went
 * from about 0.5 a day to 6.6 on 2026-11-26, with a TV asking
 * `/api/tv/content` once a minute around the clock.
 *
 * 2 s keeps a connection warm between the requests of one page view (a page
 * and its background calls land well inside that) and cuts the tail by 80%.
 * The cost is a reconnect to Neon's pooler after a quiet gap. `DATABASE_POOL_IDLE_MS`
 * overrides it; anything that is not a whole number from 100 to 60,000 is
 * ignored, so a typo cannot turn the timeout off (0 means "never close" to
 * node-postgres, which would hold connections on a frozen instance).
 */
export const DEFAULT_POOL_IDLE_MS = 2_000

const MIN_POOL_IDLE_MS = 100
const MAX_POOL_IDLE_MS = 60_000

export function poolIdleMs(raw: string | undefined = process.env.DATABASE_POOL_IDLE_MS): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_POOL_IDLE_MS
  const n = Number(raw)
  if (!Number.isInteger(n) || n < MIN_POOL_IDLE_MS || n > MAX_POOL_IDLE_MS) {
    return DEFAULT_POOL_IDLE_MS
  }
  return n
}
