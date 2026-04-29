import { z } from "zod"
import {
  dateRangeSchema,
  parseDateRange,
  resolveStoreIds,
  storeIdsSchema,
} from "./_shared"
import type { ChatTool } from "./types"

const params = z
  .object({
    storeIds: storeIdsSchema,
    dateRange: dateRangeSchema,
    topN: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .default(10)
      .describe("Limit to the topN items by revenue. Defaults to 10."),
  })
  .strict()

export type CogsByItemRow = {
  menuItem: string
  category: string
  soldQty: number
  revenue: number
  cogs: number
  /** Margin percent ((revenue - cogs) / revenue) * 100. Null when revenue is 0. */
  marginPct: number | null
}

export const getCogsByItem: ChatTool<typeof params, CogsByItemRow[]> = {
  name: "getCogsByItem",
  description:
    "Item-level cost-of-goods + revenue + sold quantity rolled across the date range, ordered by revenue desc. Reads the precomputed DailyCogsItem rollups, so only items with a costed recipe appear.",
  parameters: params,
  async execute(args, ctx) {
    const storeIds = await resolveStoreIds(ctx, args.storeIds)
    const { from, to } = parseDateRange(args.dateRange)

    const grouped = await ctx.prisma.dailyCogsItem.groupBy({
      by: ["itemName", "category"],
      where: {
        storeId: { in: storeIds },
        date: { gte: from, lte: to },
      },
      _sum: { qtySold: true, salesRevenue: true, lineCost: true },
      orderBy: { _sum: { salesRevenue: "desc" } },
      take: args.topN ?? 10,
    })

    return grouped.map((row): CogsByItemRow => {
      const revenue = row._sum.salesRevenue ?? 0
      const cogs = row._sum.lineCost ?? 0
      return {
        menuItem: row.itemName,
        category: row.category,
        soldQty: row._sum.qtySold ?? 0,
        revenue,
        cogs,
        marginPct: revenue > 0 ? ((revenue - cogs) / revenue) * 100 : null,
      }
    })
  },
}
