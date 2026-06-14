/**
 * Canonical time-range model for the monitoring pages.
 *
 * One ?range= query param drives every panel on a page. Pages call
 * `parseRange(searchParams.range)` then `resolveWindow(key)` and hand the
 * resulting {@link TimeWindow} to their queries, so all panels move together.
 *
 * Query functions accept a TimeWindow (see e.g. getErrorsByHour) and use
 * `window.bucket` to pick hourly vs. daily aggregation — hourly for short
 * windows where per-hour detail matters, daily for long windows where 720
 * hourly points would be noise.
 */

export const RANGES = [
  { key: "1h", label: "1H", hours: 1 },
  { key: "6h", label: "6H", hours: 6 },
  { key: "24h", label: "24H", hours: 24 },
  { key: "7d", label: "7D", hours: 24 * 7 },
  { key: "30d", label: "30D", hours: 24 * 30 },
] as const

export type RangeKey = (typeof RANGES)[number]["key"]

export const DEFAULT_RANGE: RangeKey = "24h"

/** Bucket granularity flips from hour to day past this many hours. */
const HOURLY_BUCKET_CUTOFF_HOURS = 48

export type TimeWindow = {
  range: RangeKey
  since: Date
  until: Date
  hours: number
  bucket: "hour" | "day"
}

function isRangeKey(v: string | undefined): v is RangeKey {
  return RANGES.some((r) => r.key === v)
}

/** Coerce a raw search-param value (string | string[] | undefined) to a valid
 * preset key, falling back to {@link DEFAULT_RANGE} for anything unrecognized. */
export function parseRange(raw: string | string[] | undefined): RangeKey {
  const v = Array.isArray(raw) ? raw[0] : raw
  return isRangeKey(v) ? v : DEFAULT_RANGE
}

/** Resolve a preset key into a concrete {since, until} window anchored to now. */
export function resolveWindow(range: RangeKey, now: Date = new Date()): TimeWindow {
  const def = RANGES.find((r) => r.key === range) ?? RANGES.find((r) => r.key === DEFAULT_RANGE)!
  return {
    range: def.key,
    since: new Date(now.getTime() - def.hours * 3_600_000),
    until: now,
    hours: def.hours,
    bucket: def.hours <= HOURLY_BUCKET_CUTOFF_HOURS ? "hour" : "day",
  }
}

/**
 * Normalize a query-fn argument that is either a legacy `hours` number or a
 * {@link TimeWindow} into the {since, until, bucket} the SQL needs. Numeric
 * args preserve the original behavior exactly (since = now − hours, until =
 * now, hourly buckets) so existing callers and tests are unaffected.
 */
export function windowFromArg(
  arg: number | TimeWindow,
): { since: Date; until: Date; bucket: "hour" | "day" } {
  if (typeof arg === "number") {
    return { since: new Date(Date.now() - arg * 3_600_000), until: new Date(), bucket: "hour" }
  }
  return { since: arg.since, until: arg.until, bucket: arg.bucket }
}

/**
 * The quoted Postgres `date_trunc` unit for a bucket. Inlined as raw SQL
 * (via Prisma.raw) at call sites — safe because the input is a closed enum,
 * never user data.
 */
export function truncLiteral(bucket: "hour" | "day"): "'hour'" | "'day'" {
  return bucket === "day" ? "'day'" : "'hour'"
}
