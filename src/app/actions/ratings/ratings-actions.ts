// Server-only, not a server action: nothing in the browser calls these, so
// they are plain functions and cannot be invoked from outside the server.
// Browser saves go through `src/lib/counter/actions/`.
import "server-only"
import { getSession } from "@/lib/auth-scope"
import { prisma } from "@/lib/prisma"
import { parseOrderItems } from "@/lib/ratings/order-items"

/**
 * Reader for `OtterRating`.
 *
 * Star ratings, review text, platform and the items each reviewer ordered are
 * captured from Otter, and nothing in the product read the table — no page, no
 * chat tool, no query. It is the only data here that says *why* a number moved,
 * so it earns a place on the daily report rather than staying an orphan.
 *
 * Note the collection side was half-dead too: `includeRatings` was only ever
 * passed by the manual sync-button route, so the scheduled job never refreshed
 * them and the newest review on record was three months old. That is fixed in
 * scripts/backfill-otter.ts; this reader stays tolerant of a stale table.
 */

export interface RatingsSummary {
  windowDays: number
  /**
   * True when the window had no reviews and we fell back to the most recent
   * ones available. Silently rendering nothing would hide a dead sync — which
   * is exactly what happened here: ratings only refreshed on a manual button
   * press, so the newest review was three months old and the section would
   * have vanished without explanation.
   */
  stale: boolean
  /** Timestamp of the newest review on record, for a staleness caption. */
  latestReviewAt: Date | null
  count: number
  /** Mean star rating across the window, or null when there are no reviews. */
  average: number | null
  /** Reviews at 1–2 stars — the ones worth reading tonight. */
  lowCount: number
  /** Distribution indexed 0..4 for 1..5 stars. */
  distribution: number[]
  /** Change in mean vs the preceding equal-length window; null when either is empty. */
  deltaVsPrior: number | null
  /**
   * Mean and count per ordering platform, busiest first. The blended average
   * hides the thing worth acting on: a 4.1 on one platform against a 4.9 on
   * another is a fulfilment problem, not a food problem.
   */
  byPlatform: Array<{ platform: string; count: number; average: number }>
  recent: Array<{
    id: string
    rating: number
    reviewText: string | null
    platform: string
    reviewedAt: Date
    storeName: string
    /** Parsed, de-duplicated item names; empty when the review has none. */
    orderItems: string[]
  }>
}

const DEFAULT_WINDOW_DAYS = 30
const RECENT_LIMIT = 6

const RATING_ROW = {
  id: true,
  rating: true,
  reviewText: true,
  platform: true,
  reviewedAt: true,
  storeName: true,
  orderItemNames: true,
} as const

type RatingRow = {
  id: string
  rating: number
  reviewText: string | null
  platform: string
  reviewedAt: Date
  storeName: string
  orderItemNames: string | null
}

interface RatingGroup {
  platform: string
  rating: number
  _count: { _all: number }
  _max: { reviewedAt: Date | null }
}

interface RatingStats {
  count: number
  average: number | null
  priorAverage: number | null
  lowCount: number
  distribution: number[]
  latestReviewAt: Date | null
  byPlatform: Array<{ platform: string; count: number; average: number }>
}

/** Rows as the (platform, rating) groups a `groupBy` would return for them. */
function groupRows(rows: RatingRow[]): RatingGroup[] {
  const by = new Map<string, RatingGroup>()
  for (const r of rows) {
    const key = `${r.platform}\u0000${r.rating}`
    const g = by.get(key) ?? {
      platform: r.platform,
      rating: r.rating,
      _count: { _all: 0 },
      _max: { reviewedAt: null as Date | null },
    }
    g._count._all += 1
    if (g._max.reviewedAt === null || r.reviewedAt > g._max.reviewedAt) g._max.reviewedAt = r.reviewedAt
    by.set(key, g)
  }
  return [...by.values()]
}

/** Worst-first: a 5-star review needs no action, a 1-star one might. */
function worstFirst(rows: RatingRow[]): RatingRow[] {
  return [...rows].sort((a, b) =>
    a.rating !== b.rating ? a.rating - b.rating : b.reviewedAt.getTime() - a.reviewedAt.getTime(),
  )
}

/**
 * The window's figures from its (platform, rating) counts: what the loop over
 * every row computed, as integer sums over the same ratings. Null when the
 * window holds no reviews.
 */
function statsOfGroups(
  groups: RatingGroup[],
  priorGroups: Array<{ rating: number; _count: { _all: number } }>,
): RatingStats | null {
  const count = groups.reduce((n, g) => n + g._count._all, 0)
  if (count === 0) return null

  const distribution = [0, 0, 0, 0, 0]
  let sum = 0
  let lowCount = 0
  let latestReviewAt: Date | null = null
  const platformTotals = new Map<string, { count: number; sum: number }>()
  for (const g of groups) {
    const n = g._count._all
    distribution[Math.min(4, Math.max(0, g.rating - 1))] += n
    sum += g.rating * n
    if (g.rating <= 2) lowCount += n
    const at = g._max.reviewedAt
    if (at !== null && (latestReviewAt === null || at > latestReviewAt)) latestReviewAt = at
    const key = g.platform || "unknown"
    const acc = platformTotals.get(key) ?? { count: 0, sum: 0 }
    acc.count += n
    acc.sum += g.rating * n
    platformTotals.set(key, acc)
  }

  const priorCount = priorGroups.reduce((n, g) => n + g._count._all, 0)
  const priorSum = priorGroups.reduce((t, g) => t + g.rating * g._count._all, 0)

  return {
    count,
    average: sum / count,
    priorAverage: priorCount === 0 ? null : priorSum / priorCount,
    lowCount,
    distribution,
    latestReviewAt,
    byPlatform: Array.from(platformTotals.entries())
      .map(([platform, acc]) => ({ platform, count: acc.count, average: acc.sum / acc.count }))
      .sort((a, b) => b.count - a.count || a.platform.localeCompare(b.platform)),
  }
}

/**
 * Never throws. `null` means the reader COULD NOT ANSWER — there is no
 * session, or the query threw — and the caller is entitled to treat that as a
 * failure. It does NOT mean "no reviews": an account with an empty
 * `OtterRating` table gets a zero-count summary, so the difference between a
 * dead sync and a restaurant nobody has reviewed yet survives the return.
 */
export async function getRatingsSummary(input?: {
  storeId?: string | null
  windowDays?: number
}): Promise<RatingsSummary | null> {
  try {
    const session = await getSession()
    if (!session?.user) return null

    const windowDays = input?.windowDays ?? DEFAULT_WINDOW_DAYS
    const now = new Date()
    const start = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000)
    const priorStart = new Date(start.getTime() - windowDays * 24 * 60 * 60 * 1000)

    const storeWhere = {
      accountId: session.user.accountId,
      isActive: true,
      ...(input?.storeId ? { id: input.storeId } : {}),
    }

    /*
     * Counts and means come from grouped reads, and only the rows a caller can
     * render are loaded. This used to load EVERY review in both windows, with
     * its text and item names, to count stars in JS (the Overview tile prints
     * the mean, the count and the 1-2 star count; `recent` is capped at six).
     *
     * The mean is sum / count over the integer ratings, exactly as before: the
     * groups give the counts per (platform, rating), and `rating * count`
     * summed is the same integer the row loop summed.
     */
    const inWindow = { store: storeWhere, reviewedAt: { gte: start, lte: now } }
    const [groups, priorGroups, worst] = await Promise.all([
      prisma.otterRating.groupBy({
        by: ["platform", "rating"],
        where: inWindow,
        _count: { _all: true },
        _max: { reviewedAt: true },
      }),
      prisma.otterRating.groupBy({
        by: ["rating"],
        where: { store: storeWhere, reviewedAt: { gte: priorStart, lt: start } },
        _count: { _all: true },
      }),
      // Worst-first, newest first within a rating: the six `recent` shows.
      prisma.otterRating.findMany({
        where: inWindow,
        select: RATING_ROW,
        orderBy: [{ rating: "asc" }, { reviewedAt: "desc" }, { id: "asc" }],
        take: RECENT_LIMIT,
      }),
    ])

    let stale = false
    let stats: RatingStats | null = statsOfGroups(groups, priorGroups)
    let recentRows = worst

    // Nothing in the window: fall back to the newest reviews on record and say
    // so, rather than disappearing and leaving the operator to assume nobody
    // has reviewed them.
    if (stats === null) {
      const fallback = await prisma.otterRating.findMany({
        where: { store: storeWhere },
        select: RATING_ROW,
        orderBy: { reviewedAt: "desc" },
        take: 60,
      })
      /*
       * NO REVIEWS AT ALL is not a failure, and returning `null` for it made
       * the product say it was.
       *
       * `null` from this reader means "I could not answer" — no session, or a
       * thrown query — and the Overview is right to treat that as a failed
       * section. It used to mean an account with an empty `OtterRating` table
       * as well, so a restaurant nobody had reviewed yet opened its dashboard
       * to a red `!` and "Guest ratings did not load" on every single load.
       * The alarm was for a fact, and a page that cries wolf daily is a page
       * whose alarms stop being read.
       *
       * A zero-count summary says the same thing without the alarm, and the
       * Overview's `isEmpty: (r) => r.count === 0` — written for exactly this
       * and unreachable while the early return stood — now fires.
       */
      if (fallback.length === 0) {
        return {
          windowDays,
          stale: false,
          latestReviewAt: null,
          count: 0,
          average: null,
          lowCount: 0,
          distribution: [0, 0, 0, 0, 0],
          deltaVsPrior: null,
          byPlatform: [],
          recent: [],
        }
      }
      // The same fold, over the (at most 60) rows themselves; no prior window.
      stats = statsOfGroups(groupRows(fallback), [])
      recentRows = worstFirst(fallback).slice(0, RECENT_LIMIT)
      stale = true
    }
    if (stats === null) throw new Error("unreachable: a non-empty fallback has stats")

    return {
      windowDays,
      stale,
      latestReviewAt: stats.latestReviewAt,
      count: stats.count,
      average: stats.average,
      lowCount: stats.lowCount,
      distribution: stats.distribution,
      byPlatform: stats.byPlatform,
      deltaVsPrior:
        stats.average != null && stats.priorAverage != null
          ? stats.average - stats.priorAverage
          : null,
      recent: recentRows.map(({ orderItemNames, ...r }) => ({
        ...r,
        orderItems: parseOrderItems(orderItemNames),
      })),
    }
  } catch (error) {
    console.error("getRatingsSummary error:", error)
    return null
  }
}
