import { prisma } from "@/lib/prisma"
import { anchorLineWhere } from "./anchor-line"
import {
  loadRecipeGraph,
  walkRecipeForIngredientSync,
  type RecipeGraph,
} from "./recipe-walk"
import {
  depletionWindow,
  MS_PER_DAY,
  sumDeliveries,
  sumDepletion,
  type DeliveryLine,
  type SoldItem,
} from "./usage-math"
import type { RunningOnHandResult } from "./running-on-hand"
import type { DailyDepletionRateResult } from "./depletion-rate"

/**
 * Store-wide prefetch for the inventory dashboard.
 *
 * `computeRunningOnHand` and `computeDailyDepletionRate` each issue their own
 * queries per ingredient, and several of those queries (menu-item sales, item→
 * recipe mappings, the recipe tree) are identical for every ingredient at a
 * store. Called in a loop over a 76-item pantry that was ~760 round-trips to
 * render one page. This loads the same inputs once — six queries total — and
 * the readers below run the same arithmetic against them, sharing the pure
 * helpers in `usage-math.ts` so the two paths cannot drift.
 */

const DEFAULT_LOOKBACK_DAYS = 14

export interface StoreInventoryContext {
  storeId: string
  asOf: Date
  lookbackDays: number
  recipeGraph: RecipeGraph
  recipeByItemName: Map<string, string>
  /**
   * Menu-item sales after `salesCutoff` (all of them when there is no
   * cutoff) and at or before `asOf`, ascending by date.
   */
  sales: Array<SoldItem & { date: Date }>
  /**
   * Every sale at or before this, summed per item into `salesBefore` instead
   * of read day by day. It is the earliest date any reader below starts from
   * (the oldest last count, or the depletion lookback), so only an ingredient
   * that was never counted reaches back past it. Absent on a hand-built
   * context, where `sales` holds everything.
   */
  salesCutoff?: Date
  salesBefore?: SoldItem[]
  /** Latest COMPLETED count per ingredient. */
  lastCountByIngredient: Map<string, { qtyInRecipeUnit: number; countedAt: Date }>
  /** Matched invoice lines at or before `asOf`, grouped by ingredient. */
  deliveriesByIngredient: Map<string, Array<DeliveryLine & { invoiceDate: Date }>>
  /** Adjustments at or before `asOf`, grouped by ingredient. */
  adjustmentsByIngredient: Map<string, Array<{ qty: number; occurredAt: Date }>>
}

export async function loadStoreInventoryContext(input: {
  storeId: string
  accountId: string
  asOf?: Date
  lookbackDays?: number
}): Promise<StoreInventoryContext> {
  const asOf = input.asOf ?? new Date()
  const lookbackDays = input.lookbackDays ?? DEFAULT_LOOKBACK_DAYS

  const countLinesRead = prisma.stockCountLine.findMany({
    where: {
      ...anchorLineWhere,
      stockCount: {
        storeId: input.storeId,
        status: "COMPLETED",
        countedAt: { lte: asOf },
      },
    },
    select: {
      canonicalIngredientId: true,
      qtyInRecipeUnit: true,
      stockCount: { select: { countedAt: true } },
    },
    orderBy: { stockCount: { countedAt: "desc" } },
  })

  // Sales were read day by day back to the store's first order (about 10k
  // rows a store, 272 ms on the live database) although every reader starts
  // at a count or at the lookback. Read day by day only from the earliest of
  // those, and sum everything older per item in the database: a reader that
  // reaches back further (an ingredient never counted) adds the sums, so
  // every figure is the one the full read gave.
  const salesRead = countLinesRead.then(async (lines) => {
    const lookbackStart = new Date(asOf.getTime() - lookbackDays * MS_PER_DAY)
    // The oldest LAST count: lines arrive newest first, so the first line per
    // ingredient is its last count (as `lastCountByIngredient` takes it).
    let cutoff = lookbackStart
    const seen = new Set<string>()
    for (const line of lines) {
      if (!line.canonicalIngredientId || seen.has(line.canonicalIngredientId)) continue
      seen.add(line.canonicalIngredientId)
      if (line.stockCount.countedAt < cutoff) cutoff = line.stockCount.countedAt
    }
    const [recent, before] = await Promise.all([
      prisma.otterMenuItem.findMany({
        where: { storeId: input.storeId, date: { gt: cutoff, lte: asOf } },
        select: {
          date: true,
          itemName: true,
          fpQuantitySold: true,
          tpQuantitySold: true,
        },
        orderBy: { date: "asc" },
      }),
      prisma.otterMenuItem.groupBy({
        by: ["itemName"],
        where: { storeId: input.storeId, date: { lte: cutoff } },
        _sum: { fpQuantitySold: true, tpQuantitySold: true },
      }),
    ])
    return {
      cutoff,
      recent,
      before: before.map((b) => ({
        itemName: b.itemName,
        fpQuantitySold: b._sum.fpQuantitySold,
        tpQuantitySold: b._sum.tpQuantitySold,
      })),
    }
  })

  const [recipeGraph, mappings, salesSplit, countLines, deliveryLines, adjustments] =
    await Promise.all([
      loadRecipeGraph(input.accountId),
      prisma.otterItemMapping.findMany({
        where: { storeId: input.storeId },
        select: { otterItemName: true, recipeId: true },
      }),
      salesRead,
      countLinesRead,
      prisma.invoiceLineItem.findMany({
        where: {
          canonicalIngredientId: { not: null },
          invoice: { storeId: input.storeId, invoiceDate: { lte: asOf } },
        },
        select: {
          canonicalIngredientId: true,
          quantity: true,
          unit: true,
          invoice: { select: { invoiceDate: true } },
        },
      }),
      prisma.inventoryAdjustment.findMany({
        where: { storeId: input.storeId, occurredAt: { lte: asOf } },
        select: { canonicalIngredientId: true, qty: true, occurredAt: true },
      }),
    ])

  // countLines arrives newest-first, so the first row per ingredient wins —
  // the same row `findFirst` + `orderBy countedAt desc` would have returned.
  const lastCountByIngredient = new Map<
    string,
    { qtyInRecipeUnit: number; countedAt: Date }
  >()
  for (const line of countLines) {
    if (!line.canonicalIngredientId) continue
    if (lastCountByIngredient.has(line.canonicalIngredientId)) continue
    lastCountByIngredient.set(line.canonicalIngredientId, {
      qtyInRecipeUnit: line.qtyInRecipeUnit,
      countedAt: line.stockCount.countedAt,
    })
  }

  const deliveriesByIngredient = new Map<
    string,
    Array<DeliveryLine & { invoiceDate: Date }>
  >()
  for (const line of deliveryLines) {
    // An invoice with no date can't be placed relative to a count anchor, and
    // the per-ingredient query filtered on `invoiceDate` too, so it would have
    // been excluded there as well.
    if (!line.canonicalIngredientId || !line.invoice.invoiceDate) continue
    const bucket = deliveriesByIngredient.get(line.canonicalIngredientId) ?? []
    bucket.push({
      quantity: line.quantity,
      unit: line.unit,
      invoiceDate: line.invoice.invoiceDate,
    })
    deliveriesByIngredient.set(line.canonicalIngredientId, bucket)
  }

  const adjustmentsByIngredient = new Map<
    string,
    Array<{ qty: number; occurredAt: Date }>
  >()
  for (const adj of adjustments) {
    if (!adj.canonicalIngredientId) continue
    const bucket = adjustmentsByIngredient.get(adj.canonicalIngredientId) ?? []
    bucket.push({ qty: adj.qty, occurredAt: adj.occurredAt })
    adjustmentsByIngredient.set(adj.canonicalIngredientId, bucket)
  }

  return {
    storeId: input.storeId,
    asOf,
    lookbackDays,
    recipeGraph,
    recipeByItemName: new Map(mappings.map((m) => [m.otterItemName, m.recipeId])),
    sales: salesSplit.recent,
    salesCutoff: salesSplit.cutoff,
    salesBefore: salesSplit.before,
    lastCountByIngredient,
    deliveriesByIngredient,
    adjustmentsByIngredient,
  }
}

/**
 * Sales dated after `since`. A `since` before the cutoff (only an ingredient
 * with no count: its start is the epoch) also takes the per-item sums of
 * everything up to the cutoff, which is every sale it would have read.
 */
function salesAfter(ctx: StoreInventoryContext, since: Date): SoldItem[] {
  const recent = ctx.sales.filter((s) => s.date > since)
  if (!ctx.salesCutoff || since >= ctx.salesCutoff) return recent
  if (since.getTime() > 0) {
    // Not reachable from the readers here: the cutoff is the oldest start.
    throw new Error("store-inventory-context: a start before the sales cutoff that is not the epoch")
  }
  return [...(ctx.salesBefore ?? []), ...recent]
}

export interface ContextIngredient {
  id: string
  name: string
  recipeUnit: string | null
  /**
   * The pack definition, all four fields optional so a caller that has none
   * still type-checks — but a caller that omits them gets the pre-2026-08-28
   * behaviour, where every case-priced delivery was dropped. See
   * `convertDelivered` in `usage-math.ts`.
   */
  caseUnit?: string | null
  recipeUnitsPerCase?: number | null
  innerPackUnit?: string | null
  innerPacksPerCase?: number | null
}

/** Batched twin of `computeRunningOnHand` — same maths, no queries. */
export function runningOnHandFromContext(
  ctx: StoreInventoryContext,
  ingredient: ContextIngredient,
): RunningOnHandResult {
  const recipeUnit = ingredient.recipeUnit ?? ""
  const lastCount = ctx.lastCountByIngredient.get(ingredient.id)
  const baseQty = lastCount?.qtyInRecipeUnit ?? 0
  const baseAt = lastCount?.countedAt ?? null
  const sinceFilter = baseAt ?? new Date(0)

  const { deliveriesQty, partial } = sumDeliveries(
    (ctx.deliveriesByIngredient.get(ingredient.id) ?? []).filter(
      (l) => l.invoiceDate >= sinceFilter,
    ),
    recipeUnit,
    {
      caseUnit: ingredient.caseUnit ?? null,
      recipeUnitsPerCase: ingredient.recipeUnitsPerCase ?? null,
      innerPackUnit: ingredient.innerPackUnit ?? null,
      innerPacksPerCase: ingredient.innerPacksPerCase ?? null,
    },
  )

  const depletionQty = sumDepletion(
    salesAfter(ctx, sinceFilter),
    ctx.recipeByItemName,
    (recipeId) =>
      walkRecipeForIngredientSync(
        ctx.recipeGraph,
        recipeId,
        ingredient.id,
        recipeUnit,
      ),
  )

  const adjustmentsQty = (ctx.adjustmentsByIngredient.get(ingredient.id) ?? [])
    .filter((a) => a.occurredAt > sinceFilter)
    .reduce((sum, a) => sum + a.qty, 0)

  return {
    asOf: ctx.asOf,
    storeId: ctx.storeId,
    ingredientId: ingredient.id,
    ingredientName: ingredient.name,
    recipeUnit,
    baseQty,
    baseAt,
    deliveriesQty,
    depletionQty,
    adjustmentsQty,
    onHand: baseQty + deliveriesQty - depletionQty - adjustmentsQty,
    partial,
  }
}

/** Batched twin of `computeDailyDepletionRate` — same maths, no queries. */
export function dailyDepletionRateFromContext(
  ctx: StoreInventoryContext,
  ingredient: ContextIngredient,
): DailyDepletionRateResult {
  const recipeUnit = ingredient.recipeUnit ?? ""
  const lastCountAt = ctx.lastCountByIngredient.get(ingredient.id)?.countedAt ?? null
  const { windowStart, windowDays } = depletionWindow(
    ctx.asOf,
    lastCountAt,
    ctx.lookbackDays,
  )

  const depletionQty = sumDepletion(
    salesAfter(ctx, windowStart),
    ctx.recipeByItemName,
    (recipeId) =>
      walkRecipeForIngredientSync(
        ctx.recipeGraph,
        recipeId,
        ingredient.id,
        recipeUnit,
      ),
  )

  return {
    asOf: ctx.asOf,
    storeId: ctx.storeId,
    ingredientId: ingredient.id,
    windowStart,
    windowDays,
    depletionQty,
    ratePerDay: depletionQty / windowDays,
  }
}
