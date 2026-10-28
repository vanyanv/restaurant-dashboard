import { z } from "zod"
import {
  dateRangeSchema,
  parseDateRange,
  resolveStoreIds,
  storeIdsSchema,
} from "./_shared"
import type { ChatTool } from "./types"
import { getItemEconomics } from "@/lib/counter/item-economics"

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
  /** What the costed sales collected, after discounts. */
  revenue: number
  cogs: number
  /** Margin percent ((revenue - cogs) / revenue) * 100, after discounts. Null when not costed. */
  marginPct: number | null
}

export const getCogsByItem: ChatTool<typeof params, CogsByItemRow[]> = {
  name: "getCogsByItem",
  description:
    "Item-level cost-of-goods + revenue + sold quantity rolled across the date range, ordered by revenue desc. Use this for food-cost percentage, item margin context, category-level food-cost analysis, and lowest-margin menu item checks. Reads the precomputed DailyCogsItem rollups, so only items with a costed recipe appear.",
  parameters: params,
  async execute(args, ctx) {
    const storeIds = await resolveStoreIds(ctx, args.storeIds)
    const { from, to } = parseDateRange(args.dateRange)

    // The shared per-item definition (`item-economics.ts`) — the figures the
    // Catalog, Menu items and COGS pages print for the same item.
    //
    // COSTED rows only, as the description promises. The materializer also
    // writes UNMAPPED and MISSING_COST rows with real revenue and $0
    // `lineCost`; summing those in returned an item nothing has costed at
    // `cogs: 0, marginPct: 100`. Uncosted items are `getTopMenuItems`' to
    // report, which covers the full menu.
    //
    // `revenue` is what the costed sales COLLECTED once the deals came off,
    // and `marginPct` is over it: on the rung-up price a buy-one-get-one read
    // as an 89% margin when it runs ~77%.
    const { items } = await getItemEconomics({
      accountId: ctx.accountId,
      storeIds,
      startDate: from,
      // `to` is a date the rollup includes whole; orders carry a time.
      endDate: new Date(to.getTime() + 86_400_000 - 1),
      db: ctx.prisma,
    })

    return [...items.values()]
      .filter((i) => i.costed !== null)
      .map(
        (i): CogsByItemRow => ({
          menuItem: i.itemName,
          category: i.category,
          soldQty: i.costed!.units,
          revenue: i.costed!.collected,
          cogs: i.costed!.cost,
          marginPct: i.marginPct,
        }),
      )
      .sort((a, b) => b.revenue - a.revenue || a.menuItem.localeCompare(b.menuItem))
      .slice(0, args.topN ?? 10)
  },
}
