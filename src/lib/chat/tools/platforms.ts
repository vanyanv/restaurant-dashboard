import { z } from "zod"
import {
  dateRangeSchema,
  parseDateRange,
  resolveStoreIds,
  storeIdsSchema,
} from "./_shared"
import type { ChatTool } from "./types"
import { rowSales } from "@/lib/pnl"

const params = z
  .object({
    storeIds: storeIdsSchema,
    dateRange: dateRangeSchema,
  })
  .strict()

export type PlatformBreakdownRow = {
  platform: string
  gross: number
  net: number
  count: number
  /** Decimal share of total gross across the returned rows (0..1). */
  share: number
}

export const getPlatformBreakdown: ChatTool<
  typeof params,
  PlatformBreakdownRow[]
> = {
  name: "getPlatformBreakdown",
  description:
    "Per-platform gross / net / order-count split across owner-scoped stores for a date range. Each row also carries 'share' = its gross over the total — use this for 'what % of sales came from DoorDash?' style questions.",
  parameters: params,
  async execute(args, ctx) {
    const storeIds = await resolveStoreIds(ctx, args.storeIds)
    const { from, to } = parseDateRange(args.dateRange)

    const grouped = await ctx.prisma.otterDailySummary.groupBy({
      by: ["platform"],
      where: {
        storeId: { in: storeIds },
        date: { gte: from, lte: to },
      },
      _sum: {
        fpGrossSales: true,
        tpGrossSales: true,
        fpServiceCharges: true,
        tpServiceCharges: true,
        fpDiscounts: true,
        tpDiscounts: true,
        tpRefundsAdjustments: true,
        fpOrderCount: true,
        tpOrderCount: true,
      },
    })

    const rows = grouped.map((row) => {
      const s = row._sum
      // The statement's own definition (`rowSales` in `@/lib/pnl`): gross is
      // the platform's own side (fp in-house, tp on a marketplace); net adds
      // service charges, discounts and refunds — so chat matches the P&L.
      const { gross, net } = rowSales({ platform: row.platform, fpTaxCollected: null, tpTaxCollected: null, ...s })
      const count = (s.fpOrderCount ?? 0) + (s.tpOrderCount ?? 0)
      return { platform: row.platform, gross, net, count }
    })

    const totalGross = rows.reduce((sum, r) => sum + r.gross, 0)
    return rows
      .map((r) => ({
        ...r,
        share: totalGross > 0 ? r.gross / totalGross : 0,
      }))
      .sort((a, b) => b.gross - a.gross)
  },
}
