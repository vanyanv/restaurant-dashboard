import { z } from "zod"
import { embed, toVectorLiteral } from "@/lib/chat/embeddings"
import { resolveStoreIds, storeIdsSchema, ymd } from "./_shared"
import type { ChatTool } from "./types"

/**
 * Canonical-ingredient tools.
 *
 *   - getIngredientPrices: ILIKE substring lookup. High recall on common
 *     ingredients (cheese, chicken). Cheaper than embedding when the user
 *     uses the canonical's own name.
 *   - searchCanonicalIngredients: vector search. Use when phrasing might
 *     not match the canonical (vendor jargon like "16/20 EZ peel", "EVOO").
 *   - getIngredientPrice (singular, by id): detailed view of one canonical
 *     incl. the latest 3 invoice cross-checks.
 *   - getIngredientPriceHistory: time series of unit cost from
 *     InvoiceLineItem.
 *   - compareVendorPrices: vendor-by-vendor breakdown for one canonical.
 *   - listRecipesByIngredient: reverse lookup — which recipes use it.
 *   - listIngredientGaps: canonicals not seen on any invoice in the last
 *     90 days, used to surface dead-letter mappings.
 */

const PRICE_HISTORY_LOOKBACK_DAYS = 365
const GAPS_LOOKBACK_DAYS = 90

const pricesParams = z
  .object({
    query: z
      .string()
      .min(1)
      .describe("Case-insensitive substring match on the canonical ingredient name (e.g. 'cheese', 'chicken thigh')."),
    storeIds: storeIdsSchema,
    limit: z.number().int().min(1).max(25).optional().default(10),
  })
  .strict()

export type IngredientPriceRow = {
  ingredient: string
  /** Recipe unit when set, else the ingredient's default unit. */
  unit: string
  /** Dollars per recipe unit. Null when no cost has been derived yet. */
  currentCost: number | null
  costSource: "manual" | "invoice" | null
  /** Most recent linked invoice's invoice-date in `YYYY-MM-DD`, null if no invoice has linked. */
  lastInvoiceDate: string | null
  vendor: string | null
}

export const getIngredientPrices: ChatTool<typeof pricesParams, IngredientPriceRow[]> = {
  name: "getIngredientPrices",
  description:
    "Lookup current cost-per-unit for owner-scoped canonical ingredients, ranked by recency of the last linked invoice. Use this for 'what's the cost of cheese?' / 'how much are we paying for chicken thighs?' style questions when the user uses the canonical name. Names short and explicit; ILIKE-based matching, no embeddings. Use searchCanonicalIngredients instead when the user uses vendor jargon.",
  parameters: pricesParams,
  async execute(args, ctx) {
    // storeIds is accepted for symmetry with the rest of the surface, but
    // canonical ingredients are owner-level (one per owner), not store-level —
    // the assert ensures the caller can't probe foreign-store scoping.
    await resolveStoreIds(ctx, args.storeIds)

    const canonicals = await ctx.prisma.canonicalIngredient.findMany({
      where: {
        accountId: ctx.accountId,
        name: { contains: args.query, mode: "insensitive" },
      },
      select: {
        id: true,
        name: true,
        defaultUnit: true,
        recipeUnit: true,
        costPerRecipeUnit: true,
        costSource: true,
      },
      orderBy: { name: "asc" },
      take: args.limit ?? 10,
    })

    if (canonicals.length === 0) return []

    const results: IngredientPriceRow[] = []
    for (const c of canonicals) {
      const lastLine = await ctx.prisma.invoiceLineItem.findFirst({
        where: {
          canonicalIngredientId: c.id,
          invoice: { accountId: ctx.accountId },
        },
        orderBy: { invoice: { invoiceDate: "desc" } },
        select: {
          invoice: {
            select: { vendorName: true, invoiceDate: true },
          },
        },
      })

      const source = c.costSource as IngredientPriceRow["costSource"]
      results.push({
        ingredient: c.name,
        unit: c.recipeUnit ?? c.defaultUnit,
        currentCost: c.costPerRecipeUnit ?? null,
        costSource: source === "manual" || source === "invoice" ? source : null,
        lastInvoiceDate:
          lastLine?.invoice.invoiceDate
            ? ymd(lastLine.invoice.invoiceDate)
            : null,
        vendor: lastLine?.invoice.vendorName ?? null,
      })
    }
    return results
  },
}

const searchParams = z
  .object({
    query: z
      .string()
      .min(1)
      .describe("Natural-language ingredient phrase, including vendor jargon (e.g. 'shrimp', 'EVOO', '16/20 EZ peel'). Vector search folds in per-store IngredientAlias rawNames."),
    limit: z.number().int().min(1).max(25).optional().default(10),
  })
  .strict()

export type CanonicalIngredientSearchRow = {
  canonicalIngredientId: string
  name: string
  category: string | null
  /** Cosine similarity 0..1 — higher is more relevant. */
  score: number
}

export const searchCanonicalIngredients: ChatTool<typeof searchParams, CanonicalIngredientSearchRow[]> = {
  name: "searchCanonicalIngredients",
  description:
    "Vector search across the owner's canonical ingredients (with per-store aliases folded in). Use this when the user's phrasing uses vendor jargon or doesn't match the canonical's own name (e.g. 'EVOO' → 'olive oil, extra virgin', '16/20 EZ peel' → 'shrimp'). Returns canonical ids; pair with getIngredientPrice / getIngredientPriceHistory / compareVendorPrices / listRecipesByIngredient.",
  parameters: searchParams,
  async execute(args, ctx) {
    const vec = await embed(args.query)
    const lit = toVectorLiteral(vec)

    const rows = await ctx.prisma.$queryRawUnsafe<
      Array<{
        canonicalIngredientId: string
        name: string
        category: string | null
        score: number
      }>
    >(
      `SELECT e."canonicalIngredientId",
              e."name",
              e."category",
              (1 - (e.embedding <=> $1::vector))::float8 AS score
         FROM "CanonicalIngredientEmbedding" e
        WHERE e."accountId" = $2
        ORDER BY e.embedding <=> $1::vector
        LIMIT $3`,
      lit,
      ctx.accountId,
      args.limit ?? 10,
    )

    return rows.map((r) => ({
      canonicalIngredientId: r.canonicalIngredientId,
      name: r.name,
      category: r.category,
      score: Number(r.score),
    }))
  },
}

const byIdParams = z
  .object({
    canonicalIngredientId: z
      .string()
      .min(1)
      .describe("The CanonicalIngredient id (cuid). Resolve via searchCanonicalIngredients or getIngredientPrices first."),
  })
  .strict()

export type IngredientPriceCheckRow = {
  vendor: string
  productName: string
  unit: string | null
  unitPrice: number
  invoiceDate: string | null
}

export type IngredientPriceResult = {
  canonicalIngredientId: string
  name: string
  category: string | null
  unit: string
  defaultUnit: string
  /** Dollars per recipe unit. */
  currentCost: number | null
  costSource: "manual" | "invoice" | null
  costLocked: boolean
  costUpdatedAt: string | null
  /** Latest 3 invoice lines linked to this canonical (most recent first). */
  recentInvoiceLines: IngredientPriceCheckRow[]
}

export const getIngredientPrice: ChatTool<typeof byIdParams, IngredientPriceResult | null> = {
  name: "getIngredientPrice",
  description:
    "Detailed price view for one canonical ingredient by id: current cost-per-recipe-unit, source (manual / invoice), and the latest 3 invoice lines linked to it as a cross-check. Use this after searchCanonicalIngredients has resolved a fuzzy phrase to a canonical id. Returns null when the id isn't owned by the caller.",
  parameters: byIdParams,
  async execute(args, ctx) {
    const c = await ctx.prisma.canonicalIngredient.findFirst({
      where: { id: args.canonicalIngredientId, accountId: ctx.accountId },
      select: {
        id: true,
        name: true,
        category: true,
        defaultUnit: true,
        recipeUnit: true,
        costPerRecipeUnit: true,
        costSource: true,
        costLocked: true,
        costUpdatedAt: true,
      },
    })
    if (!c) return null

    const recent = await ctx.prisma.invoiceLineItem.findMany({
      where: {
        canonicalIngredientId: c.id,
        invoice: { accountId: ctx.accountId },
      },
      orderBy: { invoice: { invoiceDate: "desc" } },
      take: 3,
      select: {
        productName: true,
        unit: true,
        unitPrice: true,
        invoice: { select: { vendorName: true, invoiceDate: true } },
      },
    })

    const source = c.costSource as IngredientPriceResult["costSource"]
    return {
      canonicalIngredientId: c.id,
      name: c.name,
      category: c.category,
      unit: c.recipeUnit ?? c.defaultUnit,
      defaultUnit: c.defaultUnit,
      currentCost: c.costPerRecipeUnit ?? null,
      costSource: source === "manual" || source === "invoice" ? source : null,
      costLocked: c.costLocked,
      costUpdatedAt: c.costUpdatedAt ? ymd(c.costUpdatedAt) : null,
      recentInvoiceLines: recent.map((l) => ({
        vendor: l.invoice.vendorName,
        productName: l.productName,
        unit: l.unit,
        unitPrice: l.unitPrice,
        invoiceDate: l.invoice.invoiceDate ? ymd(l.invoice.invoiceDate) : null,
      })),
    }
  },
}

const historyParams = z
  .object({
    canonicalIngredientId: z
      .string()
      .min(1)
      .describe("The CanonicalIngredient id (cuid)."),
    days: z
      .number()
      .int()
      .min(1)
      .max(PRICE_HISTORY_LOOKBACK_DAYS)
      .optional()
      .default(180)
      .describe("Lookback window in days. Defaults to 180."),
  })
  .strict()

export type IngredientPriceHistoryRow = {
  invoiceDate: string
  vendor: string
  productName: string
  unit: string | null
  unitPrice: number
  extendedPrice: number
}

export type IngredientPriceHistoryResult = {
  canonicalIngredientId: string
  name: string
  windowDays: number
  pointCount: number
  minUnitPrice: number | null
  maxUnitPrice: number | null
  /** Most recent invoice line in window — null when nothing matched. */
  latest: IngredientPriceHistoryRow | null
  /** All invoice lines in window, oldest first. */
  rows: IngredientPriceHistoryRow[]
}

export const getIngredientPriceHistory: ChatTool<typeof historyParams, IngredientPriceHistoryResult | null> = {
  name: "getIngredientPriceHistory",
  description:
    "Time series of unit-price observations for one canonical ingredient, sourced from invoice line items linked to it. Use this for 'when did the price of EVOO last change?' / 'has chicken gone up?'. Returns null when the canonical isn't owned by the caller.",
  parameters: historyParams,
  async execute(args, ctx) {
    const c = await ctx.prisma.canonicalIngredient.findFirst({
      where: { id: args.canonicalIngredientId, accountId: ctx.accountId },
      select: { id: true, name: true },
    })
    if (!c) return null

    const days = args.days ?? 180
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    const lines = await ctx.prisma.invoiceLineItem.findMany({
      where: {
        canonicalIngredientId: c.id,
        invoice: {
          accountId: ctx.accountId,
          invoiceDate: { gte: since },
        },
      },
      orderBy: { invoice: { invoiceDate: "asc" } },
      select: {
        productName: true,
        unit: true,
        unitPrice: true,
        extendedPrice: true,
        invoice: { select: { vendorName: true, invoiceDate: true } },
      },
    })

    const rows: IngredientPriceHistoryRow[] = lines
      .filter((l) => l.invoice.invoiceDate)
      .map((l) => ({
        invoiceDate: ymd(l.invoice.invoiceDate as Date),
        vendor: l.invoice.vendorName,
        productName: l.productName,
        unit: l.unit,
        unitPrice: l.unitPrice,
        extendedPrice: l.extendedPrice,
      }))

    const prices = rows.map((r) => r.unitPrice).filter((p) => p > 0)
    return {
      canonicalIngredientId: c.id,
      name: c.name,
      windowDays: days,
      pointCount: rows.length,
      minUnitPrice: prices.length > 0 ? Math.min(...prices) : null,
      maxUnitPrice: prices.length > 0 ? Math.max(...prices) : null,
      latest: rows[rows.length - 1] ?? null,
      rows,
    }
  },
}

const compareParams = z
  .object({
    canonicalIngredientId: z.string().min(1),
    days: z
      .number()
      .int()
      .min(1)
      .max(PRICE_HISTORY_LOOKBACK_DAYS)
      .optional()
      .default(180),
  })
  .strict()

export type VendorPriceRow = {
  vendor: string
  /** Most recent unit price observed for this vendor. */
  latestUnitPrice: number
  latestInvoiceDate: string
  minUnitPrice: number
  avgUnitPrice: number
  lineCount: number
}

export type CompareVendorPricesResult = {
  canonicalIngredientId: string
  name: string
  windowDays: number
  vendors: VendorPriceRow[]
  /** Vendor with the lowest latestUnitPrice. Null when no data. */
  cheapestVendor: string | null
}

export const compareVendorPrices: ChatTool<typeof compareParams, CompareVendorPricesResult | null> = {
  name: "compareVendorPrices",
  description:
    "Compares unit prices for one canonical ingredient across vendors, using invoice line items linked via either canonicalIngredientId or IngredientSkuMatch. Use this for 'which vendor is cheapest for cheddar?' / 'who has the best chicken price?'. Returns the latest, min, and avg unit price per vendor in the window.",
  parameters: compareParams,
  async execute(args, ctx) {
    const c = await ctx.prisma.canonicalIngredient.findFirst({
      where: { id: args.canonicalIngredientId, accountId: ctx.accountId },
      select: { id: true, name: true },
    })
    if (!c) return null

    const days = args.days ?? 180
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    // Pull vendor·sku pairs from IngredientSkuMatch as a fallback path so
    // unmapped lines still get attributed when their (vendor, sku) is
    // confirmed.
    const skuMatches = await ctx.prisma.ingredientSkuMatch.findMany({
      where: { canonicalIngredientId: c.id, accountId: ctx.accountId },
      select: { vendorName: true, sku: true },
    })

    const lines = await ctx.prisma.invoiceLineItem.findMany({
      where: {
        OR: [
          { canonicalIngredientId: c.id },
          ...skuMatches.map((m) => ({
            invoice: { vendorName: m.vendorName },
            sku: m.sku,
          })),
        ],
        invoice: {
          accountId: ctx.accountId,
          invoiceDate: { gte: since },
        },
      },
      orderBy: { invoice: { invoiceDate: "asc" } },
      select: {
        unitPrice: true,
        invoice: { select: { vendorName: true, invoiceDate: true } },
      },
    })

    type Bucket = {
      vendor: string
      prices: number[]
      latestUnitPrice: number
      latestDate: Date
      lineCount: number
    }
    const buckets = new Map<string, Bucket>()
    for (const l of lines) {
      if (!l.invoice.invoiceDate || l.unitPrice <= 0) continue
      const v = l.invoice.vendorName
      const cur = buckets.get(v) ?? {
        vendor: v,
        prices: [],
        latestUnitPrice: l.unitPrice,
        latestDate: l.invoice.invoiceDate,
        lineCount: 0,
      }
      cur.prices.push(l.unitPrice)
      cur.lineCount += 1
      if (l.invoice.invoiceDate >= cur.latestDate) {
        cur.latestUnitPrice = l.unitPrice
        cur.latestDate = l.invoice.invoiceDate
      }
      buckets.set(v, cur)
    }

    const vendors: VendorPriceRow[] = Array.from(buckets.values())
      .map((b) => ({
        vendor: b.vendor,
        latestUnitPrice: b.latestUnitPrice,
        latestInvoiceDate: ymd(b.latestDate),
        minUnitPrice: Math.min(...b.prices),
        avgUnitPrice:
          b.prices.reduce((s, p) => s + p, 0) / b.prices.length,
        lineCount: b.lineCount,
      }))
      .sort((a, b) => a.latestUnitPrice - b.latestUnitPrice)

    return {
      canonicalIngredientId: c.id,
      name: c.name,
      windowDays: days,
      vendors,
      cheapestVendor: vendors[0]?.vendor ?? null,
    }
  },
}

const recipesByIngredientParams = z
  .object({
    canonicalIngredientId: z.string().min(1),
  })
  .strict()

export type RecipesUsingIngredientRow = {
  recipeId: string
  itemName: string
  category: string
  isSellable: boolean
  /** Quantity of this canonical used in the recipe. */
  quantity: number
  unit: string
}

export const listRecipesByIngredient: ChatTool<typeof recipesByIngredientParams, RecipesUsingIngredientRow[]> = {
  name: "listRecipesByIngredient",
  description:
    "Reverse lookup: which of the owner's recipes use a given canonical ingredient. Use this for 'which recipes use cilantro?' / 'what menu items have cheddar?'. Resolve the canonical id first via searchCanonicalIngredients or getIngredientPrices.",
  parameters: recipesByIngredientParams,
  async execute(args, ctx) {
    const rows = await ctx.prisma.recipeIngredient.findMany({
      where: {
        canonicalIngredientId: args.canonicalIngredientId,
        recipe: { accountId: ctx.accountId },
      },
      select: {
        quantity: true,
        unit: true,
        recipe: {
          select: {
            id: true,
            itemName: true,
            category: true,
            isSellable: true,
          },
        },
      },
      orderBy: { recipe: { itemName: "asc" } },
    })

    return rows.map((r) => ({
      recipeId: r.recipe.id,
      itemName: r.recipe.itemName,
      category: r.recipe.category,
      isSellable: r.recipe.isSellable,
      quantity: r.quantity,
      unit: r.unit,
    }))
  },
}

const gapsParams = z.object({}).strict()

export type IngredientGapRow = {
  canonicalIngredientId: string
  name: string
  category: string | null
  /** True when no IngredientSkuMatch exists for this canonical. */
  noSkuMatch: boolean
  /** True when no InvoiceLineItem has been linked in the last 90 days. */
  noRecentInvoiceLink: boolean
  /** Latest invoice date that linked to this canonical (any age), or null. */
  lastSeen: string | null
  /** True when this canonical appears on at least one Recipe (so the gap matters). */
  usedInRecipe: boolean
}

export const listIngredientGaps: ChatTool<typeof gapsParams, IngredientGapRow[]> = {
  name: "listIngredientGaps",
  description:
    "Lists canonical ingredients with mapping or invoice-data gaps: no IngredientSkuMatch rows AND/OR no recent (last 90 days) InvoiceLineItem link. Use this for 'which ingredients have I tagged but never see on invoices?' / 'show me unmapped canonicals'. Sorted with recipe-using gaps first.",
  parameters: gapsParams,
  async execute(_args, ctx) {
    const since = new Date(Date.now() - GAPS_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)

    const canonicals = await ctx.prisma.canonicalIngredient.findMany({
      where: { accountId: ctx.accountId },
      select: {
        id: true,
        name: true,
        category: true,
        skuMatches: { select: { id: true }, take: 1 },
        recipeIngredients: { select: { id: true }, take: 1 },
        invoiceLineItems: {
          select: { invoice: { select: { invoiceDate: true } } },
          orderBy: { invoice: { invoiceDate: "desc" } },
          take: 1,
        },
      },
    })

    const recentLinks = await ctx.prisma.invoiceLineItem.findMany({
      where: {
        canonicalIngredient: { accountId: ctx.accountId },
        invoice: { invoiceDate: { gte: since }, accountId: ctx.accountId },
      },
      select: { canonicalIngredientId: true },
    })
    const recentLinked = new Set(
      recentLinks
        .map((r) => r.canonicalIngredientId)
        .filter((id): id is string => !!id),
    )

    const rows: IngredientGapRow[] = canonicals
      .map((c) => ({
        canonicalIngredientId: c.id,
        name: c.name,
        category: c.category,
        noSkuMatch: c.skuMatches.length === 0,
        noRecentInvoiceLink: !recentLinked.has(c.id),
        lastSeen:
          c.invoiceLineItems[0]?.invoice.invoiceDate
            ? ymd(c.invoiceLineItems[0].invoice.invoiceDate as Date)
            : null,
        usedInRecipe: c.recipeIngredients.length > 0,
      }))
      .filter((r) => r.noSkuMatch || r.noRecentInvoiceLink)
      .sort((a, b) => {
        if (a.usedInRecipe !== b.usedInRecipe) return a.usedInRecipe ? -1 : 1
        return a.name.localeCompare(b.name)
      })

    return rows
  },
}
