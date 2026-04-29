import { Redis } from "@upstash/redis"

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
  if (
    !process.env.UPSTASH_REDIS_REST_URL ||
    !process.env.UPSTASH_REDIS_REST_TOKEN
  ) {
    return null
  }
  cachedClient = Redis.fromEnv()
  return cachedClient
}
