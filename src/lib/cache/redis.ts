import type { Redis } from "@upstash/redis"
import { countedRedis } from "@/lib/usage/redis-count"
import { rawRedis } from "@/lib/usage/raw-redis"

/**
 * Singleton Upstash Redis client. Reads `UPSTASH_REDIS_REST_URL` and
 * `UPSTASH_REDIS_REST_TOKEN` from the environment. The REST transport is
 * stateless, so a single module-level instance is fine across function
 * invocations and warm Vercel containers.
 *
 * Local dev without Upstash creds should fall through to a no-op shim —
 * the `cached()` helper handles a missing client by always running the
 * loader, so dev still works without setting up Redis.
 */
let cachedClient: Redis | null = null
let cachedClientResolved = false

export function getRedis(): Redis | null {
  if (cachedClientResolved) return cachedClient
  cachedClientResolved = true
  // Built in `@/lib/usage/raw-redis`; every command through this wrapper is
  // counted for the Usage page.
  const raw = rawRedis()
  cachedClient = raw ? countedRedis(raw) : null
  return cachedClient
}

/**
 * For sync scripts run outside Vercel (GitHub Actions). Without the Upstash
 * env a script's writes bump no closed-range generation and bust no tag, so
 * the dashboard can serve pre-sync figures for closed ranges for up to
 * CLOSED_RANGE_TTL (6h). That used to happen silently; say so in the log and
 * as an Actions warning annotation. Returns whether Redis is configured.
 */
export function warnIfNoRedis(script: string): boolean {
  if (getRedis()) return true
  const msg =
    `${script}: UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not set — ` +
    `cache will NOT be busted; closed-range figures can stay pre-sync for up to 6h.`
  console.warn(process.env.GITHUB_ACTIONS === "true" ? `::warning::${msg}` : `[cache] ${msg}`)
  return false
}

/**
 * Give a Redis call at most `ms`, then reject. The client retries on its own,
 * so on a path where Redis stands in for the database (and the database is the
 * fallback), a slow Redis must not cost more than the database would.
 */
export function redisWithin<T>(p: Promise<T>, ms = 800): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Redis took over ${ms} ms`)), ms)
  })
  return Promise.race([p, late]).finally(() => clearTimeout(timer))
}
