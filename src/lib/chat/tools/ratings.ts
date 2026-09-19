import { z } from "zod"
import { BUSINESS_TIME_ZONE } from "@/lib/counter/business-date"
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
  /** Newest review INSIDE the range, or null when the range is empty. */
  latestReviewAt: string | null
  /**
   * Newest review on record for these stores, ignoring the range.
   *
   * The distinction the prompt turns on: a range with no reviews means
   * nobody reviewed if this is recent, and means the sync is dead if it is
   * months old. `getRatingsSummary` makes the same distinction for the
   * dashboard tile, where the sync had in fact been dead for three months
   * and the section would have vanished without explanation.
   */
  latestReviewOnRecord: string | null
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

/**
 * The instant a business date begins in the restaurant's timezone.
 *
 * `new Date("2026-09-18T00:00:00.000Z")` is 17:00 on the 17th in Los
 * Angeles. This walks the offset instead of assuming one, so it is right on
 * both sides of a DST change.
 */
function zonedDayStart(ymdText: string): Date {
  const naive = new Date(`${ymdText}T00:00:00.000Z`)
  if (Number.isNaN(naive.getTime())) throw new Error("invalid date in dateRange")
  // `naive` read AS IF it were a wall clock in the business zone; the gap
  // between that and the naive value is the offset to undo.
  const asZoned = new Date(
    naive.toLocaleString("en-US", { timeZone: BUSINESS_TIME_ZONE }),
  )
  const asUtc = new Date(naive.toLocaleString("en-US", { timeZone: "UTC" }))
  return new Date(naive.getTime() + (asUtc.getTime() - asZoned.getTime()))
}

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
    "Guest star ratings and review text from the delivery platforms (Otter's review feed). view='summary' returns the count, mean, 1-5 distribution and a per-platform / per-store split over a date range. view='reviews' returns individual reviews with their text and the items each guest ordered, lowest rating first and most recent first within a rating, so the default is the worst reviews in the whole range rather than the worst of the most recent ones; pass maxRating=2 to read only complaints. This is the only source in the product for what customers said, as opposed to what they bought. When a range comes back empty the summary still reports latestReviewOnRecord, which is how to tell 'nobody reviewed us' from 'the review sync has stopped'. Reviews only exist for third-party platforms; there is no first-party review feed.",
  parameters: params,
  async execute(args, ctx) {
    const storeIds = await resolveStoreIds(ctx, args.storeIds)
    /*
     * THE LA CALENDAR DAY, NOT THE UTC ONE.
     *
     * `parseDateRange` builds UTC midnights, and its docblock says why: every
     * Otter SUMMARY table stores `@db.Date`, where UTC midnight is the
     * canonical instant. `OtterRating.reviewedAt` is not one of those -- it
     * is a real timestamp. Meanwhile the prompt injects the LA business day
     * as "today", so the model's "yesterday" is an LA calendar day.
     *
     * Left on UTC, a guest reviewing at 19:00 on the 18th is stored at
     * 02:00Z on the 19th and falls outside a range for the 18th. The entire
     * dinner service -- the shift most likely to produce a complaint -- reads
     * a day late, every day.
     */
    // Still parsed, for the from <= to check and the format validation it
    // owns; only the instants it produces are wrong for this column.
    parseDateRange(args.dateRange)
    const from = zonedDayStart(args.dateRange.from)
    const toEnd = new Date(
      zonedDayStart(args.dateRange.to).getTime() + 24 * 60 * 60 * 1000 - 1,
    )

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
      /*
       * WORST FIRST IN THE QUERY, not after a cap.
       *
       * Ordering by date and then re-sorting in JS returns the worst of the
       * most RECENT page, which is not the worst in the range: with 400
       * reviews in a month and a limit of 15, the one-star review from the
       * 3rd never appears. The database can do both keys at once, so it does,
       * and the cap is then exact.
       *
       * The summary takes every row: a distribution computed from a page is
       * not a distribution.
       */
      orderBy:
        args.view === "reviews"
          ? [{ rating: "asc" as const }, { reviewedAt: "desc" as const }]
          : { reviewedAt: "desc" as const },
      ...(args.view === "reviews" ? { take: Math.max(args.limit ?? 15, 1) } : {}),
    })

    if (args.view === "reviews") {
      const limit = args.limit ?? 15
      return {
        view: "reviews",
        reviews: rows
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

    /*
     * One extra row, only when the range came back empty. That is the only
     * case where the answer turns on it, and paying for it on every summary
     * would put a second query behind the common question to serve the rare
     * one.
     */
    const onRecord =
      rows.length > 0
        ? rows[0].reviewedAt
        : (
            await ctx.prisma.otterRating.findFirst({
              where: {
                storeId: { in: storeIds },
                ...(args.platform ? { platform: args.platform } : {}),
              },
              select: { reviewedAt: true },
              orderBy: { reviewedAt: "desc" },
            })
          )?.reviewedAt ?? null

    return {
      view: "summary",
      summary: {
        count: rows.length,
        average: mean(rows.map((r) => r.rating)),
        lowCount: rows.filter((r) => r.rating <= 2).length,
        distribution,
        latestReviewAt: rows.length > 0 ? ymd(rows[0].reviewedAt) : null,
        latestReviewOnRecord: onRecord ? ymd(onRecord) : null,
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
