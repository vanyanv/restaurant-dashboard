import { AsyncLocalStorage } from "node:async_hooks"
import { getRedis } from "./redis"
import { addDaysLA, todayInLA } from "@/lib/dashboard-utils"

/**
 * Saved figures for past days.
 *
 * ## Why
 *
 * A range-scoped Counter read used to live in Redis for at most 300 s, and in
 * practice far less: the hourly Otter sync busts the broad `otter`/`dash` tags
 * and the current month's tag, so last week's labour or channel mix was thrown
 * away every hour even though nothing about last week had changed. With Neon
 * asleep most of the day, nearly every look at a past period paid for the
 * query again.
 *
 * ## How
 *
 * A range that ends before today (LA) is "closed". Its cache key carries a
 * version instead of tags, and the entry lives for `CLOSED_RANGE_TTL`. The
 * version is read from Redis before the figure is loaded and is made of:
 *
 * - one counter per LA day, `cache:dv:YYYY-MM-DD`, bumped by the dated syncs
 *   (hourly Otter, Harri, COGS sweep) for exactly the days they wrote;
 * - one global counter, `cache:closed-gen`, bumped by every other write to a
 *   model that feeds a figure (the Prisma extension in `@/lib/prisma`): a
 *   store setting, an invoice, a recipe, a manual Otter backfill.
 *
 * A changed version is a different key, so the old entry is simply never read
 * again. The hourly sync rewrites today and yesterday, so it moves only those
 * two days' versions and last week's saved figures survive it.
 *
 * Every bump happens AFTER its write, and every reader reads the version
 * BEFORE its data. So a reader that loaded rows from before a write saved them
 * under a version that the write's bump then retired. That ordering is the
 * whole correctness argument; keep it when changing anything here.
 *
 * Known limits, each bounded:
 * - Inside an interactive transaction the per-statement bump lands before
 *   COMMIT; the extension bumps again when the request finishes (`after`), so
 *   an old figure can be served only until the writing request ends.
 * - A scoped sync killed at its time limit never reaches its `finally` bump.
 *   The next run of the same cron rewrites and bumps the same days (hourly
 *   for Otter, 4-hourly for Harri and the COGS sweep), inside the TTL.
 * - A failed INCR is logged, not retried; the TTL caps it.
 *
 * The TTL is the backstop for writes the app never sees: a script run without
 * Upstash credentials, or SQL typed into Neon by hand.
 */

/** Six hours. The backstop, not the invalidation mechanism. */
export const CLOSED_RANGE_TTL = 6 * 60 * 60

/**
 * Prefix of the marker tag. `cached()` sees it, strips it, appends the
 * version to the key and uses `CLOSED_RANGE_TTL`. Never stored as a tag set.
 */
export const CLOSED_RANGE_TAG = "__closed-range__:"

/** Ranges longer than this are not saved (one Redis key per day is read). */
const MAX_CLOSED_DAYS = 400

/** Day counters outlive every entry that could have read them. */
const DAY_VERSION_TTL = 14 * 24 * 60 * 60

const GEN_KEY = "cache:closed-gen"
const dayKey = (d: string) => `cache:dv:${d}`

/** `YYYY-MM-DD` from a `toQueryBounds`-style date (LA calendar day as UTC). */
const ymd = (d: Date) => d.toISOString().slice(0, 10)

/**
 * The Monday..Sunday span around `from`..`to`. The Harri syncs rewrite whole
 * ISO weeks (positions are pulled per week; the schedule replaces whole weeks),
 * so the days they retire must be the weeks, not just the window asked for.
 */
export function laIsoWeeksSpanning(from: string, to: string): string[] {
  const dow = (d: string) => (new Date(`${d.slice(0, 10)}T12:00:00Z`).getUTCDay() + 6) % 7
  const lo = addDaysLA(from.slice(0, 10), -dow(from))
  const hi = addDaysLA(to.slice(0, 10), 6 - dow(to))
  return laDatesBetween(lo, hi)
}

/** Every LA date from `from` to `to`, inclusive, as `YYYY-MM-DD`. */
export function laDatesBetween(from: string, to: string): string[] {
  const out: string[] = []
  let d = from.slice(0, 10)
  const end = to.slice(0, 10)
  for (let i = 0; d <= end && i <= MAX_CLOSED_DAYS; i++) {
    out.push(d)
    d = addDaysLA(d, 1)
  }
  return out
}

/**
 * Whether a range ending at `endDate` is closed: it ends before today in LA.
 * `endDate` follows the `toQueryBounds` convention, so its UTC slice is the
 * LA date, the same rule `rangeTtl` uses.
 */
export function isClosedRange(endDate: Date, today: string = todayInLA()): boolean {
  if (Number.isNaN(endDate.getTime())) return false
  return ymd(endDate) < today
}

/**
 * Tags for a range-scoped read: the closed marker for a past range, otherwise
 * the broad tags plus month tags the caller already used.
 */
export function rangeScopedTags(
  startDate: Date,
  endDate: Date,
  openTags: string[],
): string[] {
  if (Number.isNaN(startDate.getTime()) || !isClosedRange(endDate)) return openTags
  const [lo, hi] = startDate <= endDate ? [startDate, endDate] : [endDate, startDate]
  if (laDatesBetween(ymd(lo), ymd(hi)).length > MAX_CLOSED_DAYS) return openTags
  return [`${CLOSED_RANGE_TAG}${ymd(lo)}:${ymd(hi)}`]
}

/** Parse a marker back into its range, or null if the tag is not one. */
export function parseClosedMarker(tag: string): { from: string; to: string } | null {
  if (!tag.startsWith(CLOSED_RANGE_TAG)) return null
  const [from, to] = tag.slice(CLOSED_RANGE_TAG.length).split(":")
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(to ?? "")) {
    return null
  }
  return { from, to }
}

/** FNV-1a, so a 56-day version list becomes a short key suffix. */
function hash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

/**
 * The version of a closed range right now: the global generation plus every
 * day's counter, in one MGET. Null when Redis is not configured.
 */
export async function closedRangeVersion(from: string, to: string): Promise<string | null> {
  const redis = getRedis()
  if (!redis) return null
  const days = laDatesBetween(from, to)
  const values = await redis.mget<(number | string | null)[]>(GEN_KEY, ...days.map(dayKey))
  const parts = values.map((v) => String(Number(v ?? 0) || 0))
  return `${parts[0]}.${hash(parts.slice(1).join(","))}`
}

/* ------------------------------------------------------------------------ */
/* Writers                                                                  */
/* ------------------------------------------------------------------------ */

async function incrGeneration(): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  try {
    await redis.incr(GEN_KEY)
  } catch (err) {
    // A failed bump must not fail the write that triggered it. The TTL caps
    // how long a missed bump can show an old figure.
    console.error("[cache] closed-gen bump failed", err)
  }
}

/*
 * Global bumps are coalesced so a writer that issues hundreds of statements
 * does not issue hundreds of INCRs, without ever skipping the one that
 * matters: a bump must START after the write it follows. A bump not yet
 * started is shared by every writer that arrives before it starts; once it is
 * in flight, the next writer queues exactly one more behind it.
 */
let chain: Promise<void> = Promise.resolve()
let queued: Promise<void> | null = null

export function bumpClosedGeneration(): Promise<void> {
  if (queued) return queued
  const next = chain.then(() => {
    queued = null
    return incrGeneration()
  })
  queued = next
  chain = next
  return next
}

/** Bump the counters of exactly these LA days. */
export async function bumpDays(dates: string[]): Promise<void> {
  const redis = getRedis()
  const unique = [...new Set(dates.map((d) => d.slice(0, 10)))]
  if (!redis || unique.length === 0) return
  try {
    const pipe = redis.pipeline()
    for (const d of unique) {
      pipe.incr(dayKey(d))
      pipe.expire(dayKey(d), DAY_VERSION_TTL)
    }
    await pipe.exec()
  } catch (err) {
    console.error("[cache] day-version bump failed", err)
  }
}

/**
 * Models whose rows feed a saved past-day figure. A write to any of these
 * bumps the generation; writes to anything else (page views, chat, check
 * ticks, monitoring) do not, or the crew's check-ins and every page view would
 * clear the cache.
 *
 * Adding a cached closed-range reader that reads a model not listed here is
 * how this goes stale: add the model in the same change.
 */
export const FIGURE_MODELS: ReadonlySet<string> = new Set([
  "Account",
  "Store",
  "StoreFixedExpense",
  "OtterStore",
  "OtterDailySummary",
  "OtterHourlySummary",
  "OtterMenuCategory",
  "OtterMenuItem",
  "OtterOrder",
  "OtterOrderItem",
  "OtterOrderSubItem",
  "OtterItemMapping",
  "OtterSubItemMapping",
  "Invoice",
  "InvoiceLineItem",
  "Recipe",
  "RecipeIngredient",
  "CanonicalIngredient",
  "IngredientSkuMatch",
  "IngredientAlias",
  "DailyCogsItem",
  "HarriBrand",
  "HarriDailyLabor",
  "HarriPositionDaily",
  "HarriTimekeepingAlert",
  "HarriShift",
  "HarriEmployee",
])

const WRITE_OPS: ReadonlySet<string> = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
  "delete",
  "deleteMany",
  "$executeRaw",
  "$executeRawUnsafe",
])

/**
 * Whether a Prisma operation should bump the generation. Raw `$executeRaw`
 * names no model, so it counts as a figure write: the safe direction.
 */
export function isFigureWrite(model: string | undefined, operation: string): boolean {
  if (!WRITE_OPS.has(operation)) return false
  if (!model) return true
  return FIGURE_MODELS.has(model)
}

/**
 * Whether a write's result says it touched no row: `$executeRaw` returns the
 * affected-row count, `createMany`/`updateMany`/`deleteMany` return
 * `{ count }`. The change-only sync upserts (`@/lib/upsert-changed`) usually
 * affect nothing, and a write that changed no row cannot have moved a saved
 * figure, so it must not clear the cache.
 */
export function wroteNoRows(result: unknown): boolean {
  if (result === 0) return true
  if (result !== null && typeof result === "object" && !Array.isArray(result)) {
    const keys = Object.keys(result)
    return keys.length === 1 && keys[0] === "count" && (result as { count: unknown }).count === 0
  }
  return false
}

const scoped = new AsyncLocalStorage<true>()

export function inScopedWrites(): boolean {
  return scoped.getStore() === true
}

/**
 * Run a writer that only touches the given LA dates (`YYYY-MM-DD`) without a
 * global bump per write; afterwards, bump exactly those days. In `finally`,
 * because a writer that failed halfway may still have written. If `dates`
 * cannot answer, fall back to the global bump.
 */
export async function withScopedWrites<T>(
  dates: () => string[],
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await scoped.run(true, fn)
  } finally {
    let written: string[] | null
    try {
      written = dates()
    } catch {
      written = null
    }
    if (written === null) await bumpClosedGeneration()
    else await bumpDays(written)
  }
}
