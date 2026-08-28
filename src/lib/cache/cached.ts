import { getRedis } from "./redis"
import {
  bumpHit,
  bumpMiss,
  bumpWrite,
  bumpBust,
  bumpFailure,
  prefixOf,
} from "@/lib/monitoring/cache-stats"
import { recordError } from "@/lib/monitoring/errors"

/**
 * Tag-aware read-through cache backed by Upstash Redis.
 *
 * Usage:
 *   await cached(
 *     `pnl:account:${accountId}:range:${range}`,
 *     300,                              // TTL in seconds
 *     ["pnl", `account:${accountId}`],  // tags this key belongs to
 *     () => loadPnLUncached(...),       // loader; runs on miss
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

/**
 * Month tags — how a writer invalidates only the ranges it actually touched.
 *
 * ## The problem these solve
 *
 * `getAllStoresPnL` caches per (account, start, end, granularity) for 600s and
 * tags every entry `"pnl"`. Three writers then bust that one tag:
 * `/api/cron/otter/hourly` EVERY HOUR, `/api/cron/harri` and `/api/otter/sync`
 * every four. `bustTags(["pnl"])` deletes every key in the tag, so an hourly
 * sync that wrote today and yesterday also evicted a trailing-eight-week
 * statement from six weeks ago that it did not touch. The 600s TTL never got
 * to matter: the entry was gone long before it expired.
 *
 * A month tag lets a writer say WHICH months moved. A reader's key joins the
 * tag for every month its range spans, and a writer busts only the months it
 * wrote. September's statement survives an October sync.
 *
 * ## Why months, and not days
 *
 * One tag set per day would be ~30x the sets for the same effect: a cached
 * range almost always spans whole weeks or months, so a day-granular bust
 * would still hit nearly every key a month-granular one does. Months are the
 * coarsest unit that separates "the range I am looking at" from "the range
 * the sync just wrote", which is the distinction that was missing.
 *
 * ## UTC, on both sides, deliberately
 *
 * Under-invalidation here means stale money on screen, so the two sides must
 * agree about which month a date is in. They do, and not by luck:
 * `toQueryBounds` builds its bounds as `Date.UTC(localY, localM, localD)`, so
 * a key's UTC month IS its local calendar month; and `datesCovered` from the
 * hourly sync is a list of LA calendar days as `YYYY-MM-DD`, parsed here as
 * UTC. Both therefore name the same month for the same day.
 *
 * The failure directions are not symmetric, and the safe one is chosen
 * throughout: tagging a key with a month it barely touches costs one
 * unnecessary refetch, while missing a month shows a stale figure. Ranges are
 * expanded to whole months on the key side for that reason.
 */
const MONTH_TAG_PREFIX = "pnl:m:"

/**
 * The tag for ranges too long to enumerate, and the reason it exists.
 *
 * A custom range is user input (`?from=…&to=…`), so nothing stops a reader
 * asking for twenty years and producing 240 tags on one key. Past
 * `MAX_MONTH_TAGS` the range gets this single tag instead — and every narrow
 * bust below includes it, so such a key is still invalidated by any writer.
 * Coarse, but never stale: the alternative (silently dropping the month tags)
 * would leave a key that no narrow bust can ever reach.
 */
const WIDE_RANGE_TAG = `${MONTH_TAG_PREFIX}wide`
const MAX_MONTH_TAGS = 24

/** `2026-08` — the UTC month a date falls in. */
function utcMonthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
}

/**
 * One tag per calendar month the range touches, inclusive of both ends.
 * Attach these to a cache entry alongside its broad tag.
 */
export function monthTags(start: Date, end: Date): string[] {
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    // An unparseable bound cannot be placed in a month. Fall back to the tag
    // every bust reaches rather than tagging nothing.
    return [WIDE_RANGE_TAG]
  }
  const [lo, hi] = start.getTime() <= end.getTime() ? [start, end] : [end, start]

  const months: string[] = []
  const cursor = new Date(Date.UTC(lo.getUTCFullYear(), lo.getUTCMonth(), 1))
  const last = Date.UTC(hi.getUTCFullYear(), hi.getUTCMonth(), 1)
  while (cursor.getTime() <= last) {
    if (months.length >= MAX_MONTH_TAGS) return [WIDE_RANGE_TAG]
    months.push(`${MONTH_TAG_PREFIX}${utcMonthKey(cursor)}`)
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }
  return months
}

/**
 * The tags a writer should bust, given the calendar days it wrote.
 *
 * Accepts `YYYY-MM-DD` strings (what the hourly sync's `datesCovered`
 * reports) and `Date`s. Always includes `WIDE_RANGE_TAG`, so a range too long
 * to enumerate is still invalidated — see that constant.
 */
export function monthTagsForDates(dates: Array<string | Date>): string[] {
  const out = new Set<string>([WIDE_RANGE_TAG])
  for (const d of dates) {
    const parsed = typeof d === "string" ? new Date(`${d.slice(0, 10)}T00:00:00Z`) : d
    if (Number.isNaN(parsed.getTime())) continue
    out.add(`${MONTH_TAG_PREFIX}${utcMonthKey(parsed)}`)
  }
  return [...out]
}

/** The month tags covering an inclusive date range a writer wrote. */
export function monthTagsForRange(start: Date, end: Date): string[] {
  const tags = monthTags(start, end)
  return tags.includes(WIDE_RANGE_TAG) ? tags : [...tags, WIDE_RANGE_TAG]
}

export async function cached<T>(
  key: string,
  ttlSeconds: number,
  tags: string[],
  loader: () => Promise<T>,
): Promise<T> {
  const redis = getRedis()
  if (!redis) return loader()

  const prefix = prefixOf(key)

  try {
    const hit = await redis.get<T>(key)
    if (hit !== null && hit !== undefined) {
      bumpHit(prefix)
      return hit
    }
  } catch (err) {
    console.error("[cache] read failed", { key, err })
    bumpFailure(prefix)
    await recordError({
      source: "cache",
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      metadata: { op: "read", key },
    })
    return loader()
  }

  bumpMiss(prefix)
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
    bumpWrite(prefix)
  } catch (err) {
    console.error("[cache] write failed", { key, err })
    bumpFailure(prefix)
    await recordError({
      source: "cache",
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      metadata: { op: "write", key },
    })
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
          bumpBust(tag)
          return
        }
        const pipe = redis.pipeline()
        for (const k of members) pipe.del(k)
        pipe.del(setKey)
        await pipe.exec()
        bumpBust(tag)
      }),
    )
  } catch (err) {
    console.error("[cache] bustTags failed", { tags, err })
    for (const tag of tags) bumpFailure(tag)
    await recordError({
      source: "cache",
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      metadata: { op: "bust", tags },
    })
  }
}
