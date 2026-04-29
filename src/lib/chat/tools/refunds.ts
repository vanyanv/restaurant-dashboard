import { z } from "zod"
import {
  dateRangeSchema,
  parseDateRange,
  resolveStoreIds,
  storeIdsSchema,
  ymd,
} from "./_shared"
import type { ChatTool } from "./types"

const params = z
  .object({
    storeIds: storeIdsSchema,
    dateRange: dateRangeSchema,
    groupBy: z
      .enum(["day", "platform"])
      .optional()
      .default("platform")
      .describe(
        "How to bucket the refunds. 'platform' rolls into Otter's pos_summary_ofo. 'day' returns one row per date.",
      ),
  })
  .strict()

export type RefundRow = {
  /** Present when groupBy === 'day'. */
  date?: string
  /** Present when groupBy === 'platform'. */
  platform?: string
  /** Sum of `tpRefundsAdjustments` across the bucket; positive numbers in
   *  the source data mean refund/adjustment dollars. Treated as a magnitude
   *  for display (we don't flip sign here). */
  refunds: number
}

/**
 * Refunds tool. Source field: `OtterDailySummary.tpRefundsAdjustments` —
 * only third-party platforms record this in the daily summary; first-party
 * cash/card refunds aren't broken out. The chat surfaces this honestly:
 * the tool description names the limitation so the model can defer when
 * the user asks about FP refunds.
 */
export const getRefunds: ChatTool<typeof params, RefundRow[]> = {
  name: "getRefunds",
  description:
    "Returns refunds + adjustments from the Otter daily summary across an owner-scoped slice of stores. Source data covers third-party platforms only (DoorDash / UberEats / Grubhub etc.); first-party cash/card refunds are not in the daily summary. groupBy 'platform' is the default; use 'day' for trend questions.",
  parameters: params,
  async execute(args, ctx) {
    const storeIds = await resolveStoreIds(ctx, args.storeIds)
    const { from, to } = parseDateRange(args.dateRange)
    const groupKey = args.groupBy ?? "platform"

    if (groupKey === "platform") {
      const grouped = await ctx.prisma.otterDailySummary.groupBy({
        by: ["platform"],
        where: {
          storeId: { in: storeIds },
          date: { gte: from, lte: to },
        },
        _sum: { tpRefundsAdjustments: true },
      })
      return grouped
        .map((r) => ({
          platform: r.platform,
          refunds: r._sum.tpRefundsAdjustments ?? 0,
        }))
        .filter((r) => r.refunds !== 0)
        .sort((a, b) => b.refunds - a.refunds)
    }

    const grouped = await ctx.prisma.otterDailySummary.groupBy({
      by: ["date"],
      where: {
        storeId: { in: storeIds },
        date: { gte: from, lte: to },
      },
      _sum: { tpRefundsAdjustments: true },
      orderBy: { date: "asc" },
    })
    return grouped
      .map((r) => ({
        date: ymd(r.date as Date),
        refunds: r._sum.tpRefundsAdjustments ?? 0,
      }))
      .filter((r) => r.refunds !== 0)
  },
}
