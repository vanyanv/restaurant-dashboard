import { getRedis } from "./redis"

/**
 * Tag-aware read-through cache backed by Upstash Redis.
 *
 * Usage:
 *   await cached(
 *     `pnl:owner:${ownerId}:range:${range}`,
 *     300,                          // TTL in seconds
 *     ["pnl", `owner:${ownerId}`],  // tags this key belongs to
 *     () => loadPnLUncached(...),   // loader; runs on miss
 *   )
 *
 * Each tag is backed by a Redis Set named `tag:{tag}` whose members are
 * cache keys. `bustTags(["pnl"])` reads the tag set, deletes every key it
 * contains, then deletes the tag set itself. Sets are sized by the number
 * of distinct keys that share the tag, which for our use case (per-owner
 * aggregations) stays small — under a few hundred entries.
 *
 * Failure mode: if Redis is unreachable or env vars aren't set, both
 * `cached()` and `bustTags()` log and fall through to the loader / no-op.
 * Callers never see a cache failure; they just don't get the speedup.
 */

const TAG_PREFIX = "tag:"

export async function cached<T>(
  key: string,
  ttlSeconds: number,
  tags: string[],
  loader: () => Promise<T>,
): Promise<T> {
  const redis = getRedis()
  if (!redis) return loader()

  try {
    const hit = await redis.get<T>(key)
    if (hit !== null && hit !== undefined) return hit
  } catch (err) {
    console.error("[cache] read failed", { key, err })
    return loader()
  }

  const value = await loader()

  // Don't cache null/undefined — Upstash JSON-decodes "null" back to null,
  // which is indistinguishable from a key miss on read. The early-exit
  // paths that return null in our server actions are already fast.
  if (value === null || value === undefined) return value

  try {
    // Pipeline the SET + tag-membership writes so the whole "publish"
    // costs one round-trip.
    const pipe = redis.pipeline()
    pipe.set(key, value, { ex: ttlSeconds })
    for (const tag of tags) {
      pipe.sadd(`${TAG_PREFIX}${tag}`, key)
    }
    await pipe.exec()
  } catch (err) {
    console.error("[cache] write failed", { key, err })
  }

  return value
}

/**
 * Deterministic compact serialization of the args object used to derive a
 * cache key. Keys are sorted so `{a:1,b:2}` and `{b:2,a:1}` collide. Dates
 * are serialized via ISO; primitives via String(); nested objects recurse.
 */
export function stableKey(obj: unknown): string {
  if (obj === null || obj === undefined) return ""
  if (obj instanceof Date) return obj.toISOString()
  if (typeof obj !== "object") return String(obj)
  if (Array.isArray(obj)) return `[${obj.map(stableKey).join(",")}]`
  const o = obj as Record<string, unknown>
  return Object.keys(o)
    .sort()
    .map((k) => `${k}=${stableKey(o[k])}`)
    .join("|")
}

/**
 * Invalidate every cached key tagged with any of `tags`. Call this in the
 * mutation path that changes the underlying data. Multiple tag busts can
 * be passed in one call; they're processed in parallel.
 */
export async function bustTags(tags: string[]): Promise<void> {
  if (tags.length === 0) return
  const redis = getRedis()
  if (!redis) return

  try {
    await Promise.all(
      tags.map(async (tag) => {
        const setKey = `${TAG_PREFIX}${tag}`
        const members = (await redis.smembers(setKey)) as string[]
        if (members.length === 0) {
          await redis.del(setKey)
          return
        }
        const pipe = redis.pipeline()
        for (const k of members) pipe.del(k)
        pipe.del(setKey)
        await pipe.exec()
      }),
    )
  } catch (err) {
    console.error("[cache] bustTags failed", { tags, err })
  }
}
