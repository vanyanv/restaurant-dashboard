import { monthTags } from "./cached"
import { todayInLA } from "@/lib/dashboard-utils"

/**
 * Cache policy for Counter's range-scoped reads.
 *
 * ## Why this exists
 *
 * The Counter rebuild moved the read path into `src/lib/counter/**` and left
 * the Redis layer behind: 39 files here query Prisma directly and not one of
 * them called `cached()`. The writers never stopped busting — `/api/otter/sync`
 * busts `["otter","dash","pnl"]`, `/api/cron/otter/hourly` busts `["otter",
 * "dash", ...monthTagsForDates(datesCovered)]` — so every sync was invalidating
 * keys that no longer existed while every page load went straight to Postgres.
 *
 * These helpers exist so the rollout across those files states the TTL rule and
 * the tag vocabulary ONCE. A per-file copy of "300 unless the range includes
 * today" is how the two halves drift apart.
 */

/**
 * Seconds to cache a read whose answer covers `endDate`.
 *
 * A range that includes today is still being written — the hourly Otter sync
 * rewrites a 2-day window every hour — so it gets the short TTL. A closed range
 * only moves when a sync backfills it, and a backfill busts the month tag
 * anyway, so the TTL there is a backstop rather than the mechanism.
 *
 * Mirrors `getMobileHomeSnapshot`, which has run this same 60/300 split in
 * production since the mobile snapshots landed.
 */
export function rangeTtl(endDate: Date): number {
  // `toQueryBounds` encodes local calendar dates as UTC (see the `monthTags`
  // docblock in @/lib/cache/cached), so the UTC slice IS the LA date and
  // compares directly against `todayInLA()`.
  return endDate.toISOString().slice(0, 10) >= todayInLA() ? 60 : 300
}

/**
 * The tags an Otter-derived, range-scoped Counter read belongs to.
 *
 * `otter` and `dash` are the broad tags `/api/otter/sync`, `/api/cron/otter/hourly`
 * and `/api/cron/harri` already bust; the month tags are what stop an hourly
 * sync that wrote today from evicting a statement from six weeks ago it never
 * touched. Both halves are required: a writer that cannot say which dates it
 * touched only reaches the broad tags, so a key must stay reachable by them.
 */
export function otterRangeTags(startDate: Date, endDate: Date): string[] {
  return ["otter", "dash", ...monthTags(startDate, endDate)]
}
