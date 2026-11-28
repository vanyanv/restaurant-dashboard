import { Redis } from "@upstash/redis"

/**
 * The Upstash client itself, built once. `getRedis()` in `@/lib/cache/redis`
 * hands out a counting wrapper around this; only the usage flush uses it bare,
 * because the flush counts its own command.
 */
let client: Redis | null = null
let resolved = false

export function rawRedis(): Redis | null {
  if (resolved) return client
  resolved = true
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return null
  client = Redis.fromEnv()
  return client
}
