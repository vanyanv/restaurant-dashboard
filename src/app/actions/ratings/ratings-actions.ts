"use server"

import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

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

/**
 * `orderItemNames` is stored as a JSON array string, and renders as literal
 * `["Cheese Fries","null"]` if passed straight through. Parse it, drop the
 * "null" placeholders Otter emits when the line is unknown, and de-duplicate
 * repeats (the same slider twice in one order tells the reader nothing).
 */
function parseOrderItems(raw: string | null): string[] {
  if (!raw) return []
  let values: unknown
  try {
    values = JSON.parse(raw)
  } catch {
    values = raw.split(",")
  }
  const list = Array.isArray(values) ? values : [values]
  const cleaned = list
    .map((v) => String(v ?? "").trim().replace(/^"|"$/g, ""))
    .filter((v) => v !== "" && v.toLowerCase() !== "null")
  return [...new Set(cleaned)]
}

const DEFAULT_WINDOW_DAYS = 30
const RECENT_LIMIT = 6

function mean(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

/**
 * Never throws — a failure yields null and the caller omits the section rather
 * than rendering a fake zero, matching the contract used by the invoice-count
 * and labor-glance readers.
 */
export async function getRatingsSummary(input?: {
  storeId?: string | null
  windowDays?: number
}): Promise<RatingsSummary | null> {
  try {
    const session = await getServerSession(authOptions)
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

    const rows = await prisma.otterRating.findMany({
      where: {
        store: storeWhere,
        reviewedAt: { gte: priorStart, lte: now },
      },
      select: {
        id: true,
        rating: true,
        reviewText: true,
        platform: true,
        reviewedAt: true,
        storeName: true,
        orderItemNames: true,
      },
      orderBy: { reviewedAt: "desc" },
    })

    let current = rows.filter((r) => r.reviewedAt >= start)
    let prior = rows.filter((r) => r.reviewedAt < start)
    let stale = false

    // Nothing in the window: fall back to the newest reviews on record and say
    // so, rather than disappearing and leaving the operator to assume nobody
    // has reviewed them.
    if (current.length === 0) {
      const fallback = await prisma.otterRating.findMany({
        where: { store: storeWhere },
        select: {
          id: true,
          rating: true,
          reviewText: true,
          platform: true,
          reviewedAt: true,
          storeName: true,
          orderItemNames: true,
        },
        orderBy: { reviewedAt: "desc" },
        take: 60,
      })
      if (fallback.length === 0) return null
      current = fallback
      prior = []
      stale = true
    }

    const latestReviewAt = current[0]?.reviewedAt ?? null

    const distribution = [0, 0, 0, 0, 0]
    for (const r of current) {
      const idx = Math.min(4, Math.max(0, r.rating - 1))
      distribution[idx] += 1
    }

    const average = mean(current.map((r) => r.rating))
    const priorAverage = mean(prior.map((r) => r.rating))

    return {
      windowDays,
      stale,
      latestReviewAt:
        current.reduce<Date | null>(
          (max, r) => (max == null || r.reviewedAt > max ? r.reviewedAt : max),
          null,
        ) ?? latestReviewAt,
      count: current.length,
      average,
      lowCount: current.filter((r) => r.rating <= 2).length,
      distribution,
      deltaVsPrior:
        average != null && priorAverage != null ? average - priorAverage : null,
      // Worst-first: a 5-star review needs no action, a 1-star one might.
      recent: [...current]
        .sort((a, b) =>
          a.rating !== b.rating
            ? a.rating - b.rating
            : b.reviewedAt.getTime() - a.reviewedAt.getTime(),
        )
        .slice(0, RECENT_LIMIT)
        .map(({ orderItemNames, ...r }) => ({
          ...r,
          orderItems: parseOrderItems(orderItemNames),
        })),
    }
  } catch (error) {
    console.error("getRatingsSummary error:", error)
    return null
  }
}
