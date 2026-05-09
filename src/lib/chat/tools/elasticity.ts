// Phase 1 — Coverage gap: surface the unused MenuItemElasticity table.
//
// The nightly pipeline fits a linear demand curve per (storeId, otterItemSkuId)
// and writes elasticity, intercept, fitR2, sampleSize, pricePointCount,
// meanPrice, meanQty. Until now no chat tool consumed any of it.
//
// Two tools:
//   - getMenuItemElasticity: list rows for a store, with confidence flags
//   - simulatePriceChange: read-only what-if using the fitted linear model

import { z } from "zod"
import { resolveStoreIds, ymd } from "./_shared"
import type { ChatTool } from "./types"

// ---------------------------------------------------------------------------
// getMenuItemElasticity
// ---------------------------------------------------------------------------

const elasticityListParams = z
  .object({
    storeId: z
      .string()
      .min(1)
      .describe(
        "Store id. Elasticity is per (store, item); resolve from listStores first.",
      ),
    minR2: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .default(0.1)
      .describe(
        "Drop fits with R² below this threshold. Below ~0.10 the curve is dominated by noise.",
      ),
    minPricePoints: z
      .number()
      .int()
      .min(2)
      .optional()
      .default(2)
      .describe(
        "Drop items with fewer than N distinct observed prices. < 2 means no price variance and the elasticity is meaningless.",
      ),
    limit: z.number().int().min(1).max(100).optional().default(30),
  })
  .strict()

export type ElasticityChatRow = {
  itemSkuId: string
  /** Negative = demand falls when price rises (typical). Positive = anomalous. */
  elasticity: number
  intercept: number
  fitR2: number
  sampleSize: number
  pricePointCount: number
  meanPrice: number
  meanQty: number
  computedAt: string
  confidence: "low" | "medium" | "high" | "no_signal"
}

function classifyConfidence(row: {
  fitR2: number
  pricePointCount: number
  sampleSize: number
}): ElasticityChatRow["confidence"] {
  if (row.pricePointCount < 2) return "no_signal"
  if (row.fitR2 < 0.1 || row.sampleSize < 14) return "low"
  if (row.fitR2 >= 0.4 && row.sampleSize >= 60) return "high"
  return "medium"
}

export const getMenuItemElasticity: ChatTool<
  typeof elasticityListParams,
  ElasticityChatRow[]
> = {
  name: "getMenuItemElasticity",
  description:
    "Returns the latest fitted price-elasticity curve per menu item for ONE store, computed nightly. Linear model: predictedQty = intercept + elasticity × price. Negative elasticity means demand falls when price rises (the typical case); positive is anomalous. fitR2 and pricePointCount are quality signals — confidence='no_signal' or 'low' means the curve isn't trustworthy. Use to answer 'which items are price-sensitive?' and as the input to simulatePriceChange.",
  parameters: elasticityListParams,
  async execute(args, ctx) {
    const ownerStoreIds = await resolveStoreIds(ctx, [args.storeId])
    if (!ownerStoreIds.includes(args.storeId)) return []
    const rows = await ctx.prisma.menuItemElasticity.findMany({
      where: {
        storeId: args.storeId,
        fitR2: { gte: args.minR2 ?? 0.1 },
        pricePointCount: { gte: args.minPricePoints ?? 2 },
      },
      orderBy: { computedAt: "desc" },
      take: args.limit ?? 30,
      select: {
        otterItemSkuId: true,
        elasticity: true,
        intercept: true,
        fitR2: true,
        sampleSize: true,
        pricePointCount: true,
        meanPrice: true,
        meanQty: true,
        computedAt: true,
      },
    })
    return rows.map((r) => ({
      itemSkuId: r.otterItemSkuId,
      elasticity: r.elasticity,
      intercept: r.intercept,
      fitR2: r.fitR2,
      sampleSize: r.sampleSize,
      pricePointCount: r.pricePointCount,
      meanPrice: r.meanPrice,
      meanQty: r.meanQty,
      computedAt: r.computedAt.toISOString(),
      confidence: classifyConfidence(r),
    }))
  },
}

// ---------------------------------------------------------------------------
// simulatePriceChange
// ---------------------------------------------------------------------------

const simulateParams = z
  .object({
    storeId: z.string().min(1),
    itemSkuId: z
      .string()
      .min(1)
      .describe(
        "The Otter item SKU / name as it appears in MenuItemElasticity rows. Get this from getMenuItemElasticity first.",
      ),
    newPrice: z
      .number()
      .positive()
      .describe("Hypothetical new menu price in dollars."),
  })
  .strict()

export type PriceSimChatResult =
  | {
      ok: true
      itemSkuId: string
      currentMeanPrice: number
      newPrice: number
      pricePctChange: number
      currentMeanDailyQty: number
      predictedDailyQty: number
      qtyPctChange: number
      currentDailyRevenue: number
      predictedDailyRevenue: number
      revenuePctChange: number
      confidence: ElasticityChatRow["confidence"]
      fitR2: number
      extrapolating: boolean
      computedAt: string
    }
  | { ok: false; error: string }

export const simulatePriceChange: ChatTool<typeof simulateParams, PriceSimChatResult> = {
  name: "simulatePriceChange",
  description:
    "Read-only what-if: given a hypothetical new price for one item, returns the linear model's predicted daily quantity and revenue using the fitted elasticity curve. extrapolating=true when the new price is more than 25% outside the observed price range — treat the projection as directional only. confidence='no_signal' or 'low' means the underlying fit is too weak for the projection to be meaningful.",
  parameters: simulateParams,
  async execute(args, ctx) {
    const ownerStoreIds = await resolveStoreIds(ctx, [args.storeId])
    if (!ownerStoreIds.includes(args.storeId)) {
      return { ok: false, error: "store_not_in_account" }
    }
    const row = await ctx.prisma.menuItemElasticity.findUnique({
      where: {
        storeId_otterItemSkuId: {
          storeId: args.storeId,
          otterItemSkuId: args.itemSkuId,
        },
      },
      select: {
        elasticity: true,
        intercept: true,
        fitR2: true,
        sampleSize: true,
        pricePointCount: true,
        meanPrice: true,
        meanQty: true,
        computedAt: true,
      },
    })
    if (!row) return { ok: false, error: "no_elasticity_row" }

    const predictedDailyQty = Math.max(0, row.intercept + row.elasticity * args.newPrice)
    const currentDailyRevenue = row.meanPrice * row.meanQty
    const predictedDailyRevenue = args.newPrice * predictedDailyQty
    const pricePctChange = (args.newPrice - row.meanPrice) / row.meanPrice
    // Within ±25% of meanPrice we're inside the observed envelope.
    const extrapolating = Math.abs(pricePctChange) > 0.25

    return {
      ok: true,
      itemSkuId: args.itemSkuId,
      currentMeanPrice: row.meanPrice,
      newPrice: args.newPrice,
      pricePctChange,
      currentMeanDailyQty: row.meanQty,
      predictedDailyQty,
      qtyPctChange:
        row.meanQty > 0 ? (predictedDailyQty - row.meanQty) / row.meanQty : 0,
      currentDailyRevenue,
      predictedDailyRevenue,
      revenuePctChange:
        currentDailyRevenue > 0
          ? (predictedDailyRevenue - currentDailyRevenue) / currentDailyRevenue
          : 0,
      confidence: classifyConfidence(row),
      fitR2: row.fitR2,
      extrapolating,
      computedAt: ymd(row.computedAt),
    }
  },
}
