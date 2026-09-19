import { z } from "zod"
import { parseOrderItems } from "@/lib/ratings/order-items"
import {
  dateRangeSchema,
  parseDateRange,
  resolveStoreIds,
  storeIdsSchema,
  ymd,
} from "./_shared"
import type { ChatTool } from "./types"

/**
 * Guest ratings. The only table in this product that says WHY a number moved.
 *
 * Until 2026-09-19 the chat could not reach it at all, and the system prompt
 * carried a refusal example for it — "I don't track sentiment in this
 * dashboard" — which was true of the chat and false of the database. The
 * daily report has read `OtterRating` since it was wired up; the assistant
 * was the last surface that could not.
 *
 * Two views rather than two tools, so a narrowed turn pays for one schema:
 * `summary` is the aggregate an owner asks for first ("how are we rated?"),
 * `reviews` is the worst-first text they ask for second ("what are people
 * actually saying?"). Both are store-scoped through `resolveStoreIds`, which
 * is the accountId boundary.
 */
const params = z
  .object({
    storeIds: storeIdsSchema,
    dateRange: dateRangeSchema,
    view: z
      .enum(["summary", "reviews"])
      .optional()
      .default("summary")
      .describe(
        "'summary' returns counts, the mean, the 1-5 distribution and a per-platform and per-store split. 'reviews' returns individual reviews with their text, worst rating first.",
      ),
    maxRating: z
      .number()
      .int()
      .min(1)
      .max(5)
      .optional()
      .describe(
        "Only used by view='reviews'. Cap the star rating, e.g. 2 to read only the complaints. Omit for every review in the range.",
      ),
    platform: z
      .string()
      .optional()
      .describe(
        "Restrict to one ordering platform as it appears in the data (DoorDash, UberEats, Grubhub). Omit for all.",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .default(15)
      .describe("Only used by view='reviews'. Maximum reviews to return."),
  })
  .strict()

export type RatingsSummaryRow = {
  count: number
  /** Mean star rating, or null when the range holds no reviews. */
  average: number | null
  /** Reviews at 1-2 stars. */
  lowCount: number
  /** Indexed 0..4 for 1..5 stars. */
  distribution: number[]
  latestReviewAt: string | null
  byPlatform: Array<{ platform: string; count: number; average: number }>
  byStore: Array<{ storeName: string; count: number; average: number }>
}

export type RatingsReviewRow = {
  rating: number
  reviewText: string | null
  platform: string
  reviewedAt: string
  storeName: string
  /** Parsed and de-duplicated; empty when the review names no items. */
  orderItems: string[]
}

export type RatingsResult =
  | { view: "summary"; summary: RatingsSummaryRow }
  | { view: "reviews"; reviews: RatingsReviewRow[] }

function mean(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

function averageBy<T>(
  rows: T[],
  key: (row: T) => string,
  rating: (row: T) => number,
): Array<{ label: string; count: number; average: number }> {
  const totals = new Map<string, { count: number; sum: number }>()
  for (const row of rows) {
    const k = key(row) || "unknown"
    const acc = totals.get(k) ?? { count: 0, sum: 0 }
    acc.count += 1
    acc.sum += rating(row)
    totals.set(k, acc)
  }
  return [...totals.entries()]
    .map(([label, acc]) => ({
      label,
      count: acc.count,
      average: acc.sum / acc.count,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

export const getRatings: ChatTool<typeof params, RatingsResult> = {
  name: "getRatings",
  description:
    "Guest star ratings and review text from the delivery platforms (Otter's review feed). view='summary' returns the count, mean, 1-5 distribution and a per-platform / per-store split over a date range. view='reviews' returns the individual reviews with their text and the items each guest ordered, worst rating first; pass maxRating=2 to read only complaints. This is the only source in the product for what customers said, as opposed to what they bought. Reviews only exist for third-party platforms; there is no first-party review feed.",
  parameters: params,
  async execute(args, ctx) {
    const storeIds = await resolveStoreIds(ctx, args.storeIds)
    const { from, to } = parseDateRange(args.dateRange)
    // `reviewedAt` is a full timestamp, not `@db.Date`, so the inclusive end
    // of the range has to reach the end of that day or every review after
    // midnight on `to` is dropped.
    const toEnd = new Date(to.getTime() + 24 * 60 * 60 * 1000 - 1)

    const rows = await ctx.prisma.otterRating.findMany({
      where: {
        storeId: { in: storeIds },
        reviewedAt: { gte: from, lte: toEnd },
        ...(args.platform ? { platform: args.platform } : {}),
        ...(args.view === "reviews" && args.maxRating != null
          ? { rating: { lte: args.maxRating } }
          : {}),
      },
      select: {
        rating: true,
        reviewText: true,
        platform: true,
        reviewedAt: true,
        storeName: true,
        orderItemNames: true,
      },
      orderBy: { reviewedAt: "desc" },
      // The summary needs every row to be honest about its distribution; the
      // review list is capped by the caller.
      ...(args.view === "reviews" ? { take: Math.max(args.limit ?? 15, 1) * 4 } : {}),
    })

    if (args.view === "reviews") {
      const limit = args.limit ?? 15
      return {
        view: "reviews",
        reviews: [...rows]
          // Worst first: a five-star review needs no action, a one-star one
          // might. Ties break to the most recent.
          .sort((a, b) =>
            a.rating !== b.rating
              ? a.rating - b.rating
              : b.reviewedAt.getTime() - a.reviewedAt.getTime(),
          )
          .slice(0, limit)
          .map((r) => ({
            rating: r.rating,
            reviewText: r.reviewText,
            platform: r.platform,
            reviewedAt: ymd(r.reviewedAt),
            storeName: r.storeName,
            orderItems: parseOrderItems(r.orderItemNames),
          })),
      }
    }

    const distribution = [0, 0, 0, 0, 0]
    for (const r of rows) {
      distribution[Math.min(4, Math.max(0, r.rating - 1))] += 1
    }

    return {
      view: "summary",
      summary: {
        count: rows.length,
        average: mean(rows.map((r) => r.rating)),
        lowCount: rows.filter((r) => r.rating <= 2).length,
        distribution,
        latestReviewAt: rows.length > 0 ? ymd(rows[0].reviewedAt) : null,
        byPlatform: averageBy(
          rows,
          (r) => r.platform,
          (r) => r.rating,
        ).map(({ label, count, average }) => ({ platform: label, count, average })),
        byStore: averageBy(
          rows,
          (r) => r.storeName,
          (r) => r.rating,
        ).map(({ label, count, average }) => ({ storeName: label, count, average })),
      },
    }
  },
}
