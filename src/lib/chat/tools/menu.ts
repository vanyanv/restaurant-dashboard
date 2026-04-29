import { z } from "zod"
import { embed, toVectorLiteral } from "@/lib/chat/embeddings"
import {
  dateRangeSchema,
  parseDateRange,
  resolveStoreIds,
  storeIdsSchema,
  ymd,
} from "./_shared"
import type { ChatTool } from "./types"

const PRICE_LOOKBACK_DAYS = 90

const menuPricesParams = z
  .object({
    storeIds: storeIdsSchema,
    itemQuery: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Optional case-insensitive substring filter on the menu-item name. Resolves to a SQL ILIKE.",
      ),
  })
  .strict()

export type MenuPriceRow = {
  store: string
  menuItem: string
  category: string
  /** Implied unit price from the most recent date with sales = totalSales / quantitySold. Combines FP + 3P channels. Null when the item has zero quantity in the lookback window. */
  currentPrice: number | null
  /** Date in `YYYY-MM-DD` of the most recent day this item sold. Approximation of "last priced at" — Otter doesn't expose menu price changes directly. */
  lastChangedAt: string | null
}

export const getMenuPrices: ChatTool<typeof menuPricesParams, MenuPriceRow[]> = {
  name: "getMenuPrices",
  description:
    "Current per-item menu price (derived from totalSales / quantitySold on the most recent day with orders) for owner-scoped stores. Looks back 90 days. The price reflects what customers actually paid, including upcharges; treat it as a strong proxy for the menu-card price, not the menu-card price itself.",
  parameters: menuPricesParams,
  async execute(args, ctx) {
    const storeIds = await resolveStoreIds(ctx, args.storeIds)
    const since = new Date(
      Date.now() - PRICE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
    )

    const rows = await ctx.prisma.otterMenuItem.findMany({
      where: {
        storeId: { in: storeIds },
        isModifier: false,
        date: { gte: since },
        ...(args.itemQuery
          ? { itemName: { contains: args.itemQuery, mode: "insensitive" } }
          : {}),
      },
      select: {
        storeId: true,
        date: true,
        category: true,
        itemName: true,
        fpTotalSales: true,
        fpQuantitySold: true,
        tpTotalSales: true,
        tpQuantitySold: true,
      },
      orderBy: { date: "desc" },
    })

    const stores = await ctx.prisma.store.findMany({
      where: { id: { in: storeIds } },
      select: { id: true, name: true },
    })
    const storeNameById = new Map(stores.map((s) => [s.id, s.name]))

    type Bucket = {
      storeId: string
      itemName: string
      category: string
      latestDate: Date
      totalSales: number
      qty: number
    }
    const groups = new Map<string, Bucket>()
    for (const r of rows) {
      const key = `${r.storeId}|${r.category}|${r.itemName}`
      const totalSales = (r.fpTotalSales ?? 0) + (r.tpTotalSales ?? 0)
      const qty = (r.fpQuantitySold ?? 0) + (r.tpQuantitySold ?? 0)
      if (qty <= 0) continue
      const cur = groups.get(key)
      if (!cur) {
        groups.set(key, {
          storeId: r.storeId,
          itemName: r.itemName,
          category: r.category,
          latestDate: r.date,
          totalSales,
          qty,
        })
      }
    }

    return Array.from(groups.values())
      .map((g): MenuPriceRow => ({
        store: storeNameById.get(g.storeId) ?? g.storeId,
        menuItem: g.itemName,
        category: g.category,
        currentPrice: g.qty > 0 ? g.totalSales / g.qty : null,
        lastChangedAt: ymd(g.latestDate),
      }))
      .sort((a, b) => a.menuItem.localeCompare(b.menuItem))
  },
}

const searchMenuParams = z
  .object({
    query: z.string().min(1).describe("Natural-language menu-item description, e.g. 'vanilla shake' or 'chicken sandwich'."),
    storeIds: storeIdsSchema,
    limit: z.number().int().min(1).max(20).optional().default(5),
  })
  .strict()

export type MenuSearchRow = {
  menuItemId: string
  itemName: string
  category: string
  store: string
  /** Cosine similarity 0..1 — higher is more relevant. */
  score: number
}

export const searchMenuItems: ChatTool<typeof searchMenuParams, MenuSearchRow[]> = {
  name: "searchMenuItems",
  description:
    "Vector search over the owner's menu-item corpus. Use this when the user's phrasing doesn't exactly match an item name (e.g. 'milkshake' → 'OREO COOKIE SHAKE'). Returns the top hits with cosine similarity scores.",
  parameters: searchMenuParams,
  async execute(args, ctx) {
    const storeIds = await resolveStoreIds(ctx, args.storeIds)
    const vec = await embed(args.query)
    const lit = toVectorLiteral(vec)

    const rows = await ctx.prisma.$queryRawUnsafe<
      Array<{
        menuItemId: string
        itemName: string
        category: string
        storeName: string
        score: number
      }>
    >(
      `SELECT e."menuItemId",
              e."itemName",
              e."category",
              s."name"   AS "storeName",
              (1 - (e.embedding <=> $1::vector))::float8 AS score
         FROM "MenuItemEmbedding" e
         JOIN "Store" s ON s.id = e."storeId"
        WHERE e."ownerId" = $2
          AND e."storeId" = ANY($3::text[])
        ORDER BY e.embedding <=> $1::vector
        LIMIT $4`,
      lit,
      ctx.ownerId,
      storeIds,
      args.limit ?? 5,
    )

    return rows.map((r) => ({
      menuItemId: r.menuItemId,
      itemName: r.itemName,
      category: r.category,
      store: r.storeName,
      score: Number(r.score),
    }))
  },
}

const itemDetailsParams = z
  .object({
    storeId: z
      .string()
      .min(1)
      .describe("The Store id (resolve via listStores when the user names a store)."),
    itemName: z
      .string()
      .min(1)
      .describe("Exact menu item name. Use searchMenuItems first if the user's phrasing might not match."),
    days: z
      .number()
      .int()
      .min(1)
      .max(180)
      .optional()
      .default(30)
      .describe("Lookback window in days. Defaults to 30."),
  })
  .strict()

export type MenuItemDailyRow = {
  date: string
  qty: number
  revenue: number
  /** Implied unit price (revenue / qty) for the day, null when qty was 0. */
  avgPrice: number | null
}

export type MenuItemDetailsResult = {
  store: string
  storeId: string
  itemName: string
  category: string
  /** Most-recent-day implied unit price across FP+3P. Null if no qty in window. */
  currentPrice: number | null
  totalQty: number
  totalRevenue: number
  daysWithSales: number
  firstSeen: string | null
  lastSeen: string | null
  daily: MenuItemDailyRow[]
}

export const getMenuItemDetails: ChatTool<typeof itemDetailsParams, MenuItemDetailsResult | null> = {
  name: "getMenuItemDetails",
  description:
    "Per-day rollup for one menu item at one store across a lookback window: qty / revenue / implied unit price by day, plus a current price. Use this when the user wants to see how a single item is doing — 'show me the chocolate shake at Hollywood', 'how's the chicken sandwich performing?'. Returns null when the item has no sales in the window.",
  parameters: itemDetailsParams,
  async execute(args, ctx) {
    const [storeId] = await resolveStoreIds(ctx, [args.storeId])
    const days = args.days ?? 30
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    const rows = await ctx.prisma.otterMenuItem.findMany({
      where: {
        storeId,
        isModifier: false,
        date: { gte: since },
        itemName: { equals: args.itemName, mode: "insensitive" },
      },
      select: {
        date: true,
        category: true,
        itemName: true,
        fpQuantitySold: true,
        fpTotalSales: true,
        tpQuantitySold: true,
        tpTotalSales: true,
      },
      orderBy: { date: "asc" },
    })

    if (rows.length === 0) return null

    const store = await ctx.prisma.store.findUnique({
      where: { id: storeId },
      select: { name: true },
    })

    let totalQty = 0
    let totalRevenue = 0
    const daily: MenuItemDailyRow[] = []
    for (const r of rows) {
      const qty = (r.fpQuantitySold ?? 0) + (r.tpQuantitySold ?? 0)
      const rev = (r.fpTotalSales ?? 0) + (r.tpTotalSales ?? 0)
      totalQty += qty
      totalRevenue += rev
      daily.push({
        date: ymd(r.date),
        qty,
        revenue: rev,
        avgPrice: qty > 0 ? rev / qty : null,
      })
    }

    // Most recent day with non-zero qty becomes the current price.
    let currentPrice: number | null = null
    for (let i = daily.length - 1; i >= 0; i--) {
      if (daily[i].qty > 0 && daily[i].avgPrice !== null) {
        currentPrice = daily[i].avgPrice
        break
      }
    }

    return {
      store: store?.name ?? storeId,
      storeId,
      itemName: rows[0].itemName,
      category: rows[0].category,
      currentPrice,
      totalQty,
      totalRevenue,
      daysWithSales: daily.filter((d) => d.qty > 0).length,
      firstSeen: daily[0]?.date ?? null,
      lastSeen: daily[daily.length - 1]?.date ?? null,
      daily,
    }
  },
}

const topMenuItemsParams = z
  .object({
    storeIds: storeIdsSchema,
    dateRange: dateRangeSchema,
    sortBy: z
      .enum(["qty", "revenue"])
      .optional()
      .default("revenue")
      .describe("Rank by units sold (qty) or by revenue. Defaults to revenue."),
    topN: z.number().int().min(1).max(50).optional().default(10),
  })
  .strict()

export type TopMenuItemRow = {
  itemName: string
  category: string
  qty: number
  revenue: number
  /** Implied per-unit price across the period. */
  avgPrice: number | null
}

export const getTopMenuItems: ChatTool<typeof topMenuItemsParams, TopMenuItemRow[]> = {
  name: "getTopMenuItems",
  description:
    "Ranks every sellable menu item across owner-scoped stores in a date range. Sort by 'revenue' (default) or 'qty'. Use this for 'top sellers' / 'best selling items' / 'most popular menu items' — covers the full menu, not just costed-recipe items the way getCogsByItem does.",
  parameters: topMenuItemsParams,
  async execute(args, ctx) {
    const storeIds = await resolveStoreIds(ctx, args.storeIds)
    const { from, to } = parseDateRange(args.dateRange)

    const grouped = await ctx.prisma.otterMenuItem.groupBy({
      by: ["itemName", "category"],
      where: {
        storeId: { in: storeIds },
        isModifier: false,
        date: { gte: from, lte: to },
      },
      _sum: {
        fpQuantitySold: true,
        fpTotalSales: true,
        tpQuantitySold: true,
        tpTotalSales: true,
      },
    })

    const sortKey = args.sortBy ?? "revenue"
    const limit = args.topN ?? 10
    const rows = grouped.map((g): TopMenuItemRow => {
      const qty = (g._sum.fpQuantitySold ?? 0) + (g._sum.tpQuantitySold ?? 0)
      const revenue = (g._sum.fpTotalSales ?? 0) + (g._sum.tpTotalSales ?? 0)
      return {
        itemName: g.itemName,
        category: g.category,
        qty,
        revenue,
        avgPrice: qty > 0 ? revenue / qty : null,
      }
    })
    rows.sort((a, b) => (sortKey === "qty" ? b.qty - a.qty : b.revenue - a.revenue))
    return rows.slice(0, limit)
  },
}
