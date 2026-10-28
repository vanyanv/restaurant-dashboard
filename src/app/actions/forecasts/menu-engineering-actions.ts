"use server"

import { getItemEconomics, type MenuMargin } from "@/lib/counter/item-economics"
import { startOfDayUTC as startOfDay } from "@/lib/date-utils"
// F22 — Menu engineering classifier. Splits the menu into the four
// classic Kasavana–Smith quadrants based on a median split of velocity
// (quantity sold) and unit margin (revenue/qty − cogs/qty):
//
//   STAR      — high margin, high velocity. Front of menu, hold price.
//   PLOWHORSE — low margin,  high volume.  Reprice or trim the recipe.
//   PUZZLE    — high margin, low volume.   Reposition or rename.
//   DOG       — low margin,  low volume.   Drop or rework.
//
// Pure read over the precomputed DailyCogsItem rollups. The materializer
// writes diagnostic rows too (UNMAPPED items carry real revenue with $0
// lineCost, and "Packaging - *" pseudo-rows carry cost with $0 revenue), so
// classification is restricted to COSTED non-Packaging rows — otherwise
// unmapped items read as fake 100%-margin STARs. The revenue the classifier
// could NOT see is reported in `coverage` so callers can qualify the result.

import { prisma } from "@/lib/prisma"
import { getCachedSession, resolveStoreContext } from "./_shared"

export type MenuQuadrant = "STAR" | "PLOWHORSE" | "PUZZLE" | "DOG"

export interface MenuEngineeringRow {
  itemName: string
  category: string
  /** Recipe backing the costed rows (null only if remapped mid-window). */
  recipeId: string | null
  soldQty: number
  revenue: number
  cogs: number
  unitPrice: number
  unitCost: number
  unitMargin: number
  totalContribution: number
  marginPct: number | null
  quadrant: MenuQuadrant
  /**
   * Price elasticity for this item, when the nightly fit produced a usable
   * one. Computed per store every night and previously obtainable only by
   * asking the chatbot — which meant the page about item pricing didn't show
   * how price actually moves volume. Null when there is no signal (fewer than
   * two observed price points, or a fit too weak to quote).
   */
  elasticity: number | null
  /** "high" | "low" — how much to trust `elasticity`. Null when absent. */
  elasticityConfidence: "high" | "low" | null
}

export interface MenuEngineeringCoverage {
  /** Revenue the classifier saw (COSTED rows, Packaging excluded). */
  costedRevenue: number
  /** Revenue on sold items with no recipe mapping — invisible to the quadrants. */
  unmappedRevenue: number
  /** Revenue on mapped items whose recipe walks to $0. */
  missingCostRevenue: number
  /** Revenue on COSTED rows whose cost is flagged understated (partialCost). */
  partialCostRevenue: number
  /** costed / (costed + unmapped + missingCost), as 0–100. 100 when nothing sold. */
  coveragePct: number
}

export interface MenuEngineeringData {
  storeId: string | null
  storeName: string | null
  windowStart: Date
  windowEnd: Date
  /** Median velocity used as the high/low split. */
  medianVelocity: number
  /** Median unit margin used as the high/low split. */
  medianUnitMargin: number
  rows: MenuEngineeringRow[]
  counts: Record<MenuQuadrant, number>
  totalContribution: number
  coverage: MenuEngineeringCoverage
  /**
   * The menu-wide blended margin — `item-economics.ts`'s `menuMargin`, over
   * every costed item BEFORE the `minSoldQty` cut. The cut is a display choice
   * for the quadrant chart; the blend is the same figure the Menu hub and
   * Product mix print.
   */
  menu: MenuMargin
}

export type GetMenuEngineeringResult =
  | { ok: true; data: MenuEngineeringData }
  | { ok: false; error: "store_not_in_account" }

export async function getMenuEngineering(input: {
  /** Omit to roll across all stores the caller owns. */
  storeId?: string
  /**
   * Days from the window's first day to `asOf`. The window is
   * `[asOf − lookbackDays, asOf]` with both ends included, so it covers
   * `lookbackDays + 1` days. A caller showing an N-day range passes `N − 1`
   * (`adapters/menu-profit.ts`, `adapters/analytics.ts`).
   */
  lookbackDays?: number
  asOf?: Date
  /** Items with fewer than this many units in the window are excluded so the
   * classifier doesn't drown in long-tail noise. */
  minSoldQty?: number
}): Promise<GetMenuEngineeringResult | null> {
  const session = await getCachedSession()
  const user = session?.user ?? null
  if (!user) return null

  const resolved = await resolveStoreContext(input.storeId, user.accountId)
  if (!resolved.ok) return resolved
  const { storeIds, storeName } = resolved.ctx

  const lookbackDays = input.lookbackDays ?? 30
  const minSoldQty = input.minSoldQty ?? 5
  const asOf = input.asOf ?? new Date()
  const windowEnd = startOfDay(asOf)
  const windowStart = new Date(windowEnd)
  windowStart.setUTCDate(windowStart.getUTCDate() - lookbackDays)

  const windowWhere = {
    storeId: { in: storeIds },
    date: { gte: windowStart, lte: windowEnd },
    category: { not: "Packaging" },
  }

  // `windowEnd` is a DATE the rollup includes whole; orders carry a time.
  const windowEndInclusive = new Date(windowEnd.getTime() + 86_400_000 - 1)

  const [economics, statusRollup, partialAgg, elasticityRows] = await Promise.all([
    // Per-item price, cost and margin — the one function every menu screen
    // reads (`item-economics.ts`): COSTED rows, Packaging out, revenue over
    // what was COLLECTED once the deals came off. A BOGO rings up twice the
    // money it brings in, so its margin and quadrant read twice as fat on the
    // rung-up price.
    getItemEconomics({
      accountId: user.accountId,
      storeIds,
      startDate: windowStart,
      endDate: windowEndInclusive,
    }),
    // Coverage stays on rung-up revenue — it is a share, not a margin.
    prisma.dailyCogsItem.groupBy({
      by: ["status"],
      where: windowWhere,
      _sum: { qtySold: true, salesRevenue: true },
    }),
    prisma.dailyCogsItem.aggregate({
      where: { ...windowWhere, status: "COSTED", partialCost: true },
      _sum: { salesRevenue: true },
    }),
    // `otterItemSkuId` is populated with the Otter item name (see
    // ml/elasticity/menu_item.py), so it joins straight onto these rows.
    prisma.menuItemElasticity.findMany({
      where: { storeId: { in: storeIds } },
      select: {
        otterItemSkuId: true,
        elasticity: true,
        fitR2: true,
        sampleSize: true,
        pricePointCount: true,
      },
    }),
  ])

  // Mirrors the confidence rule the chat tool applies: no price variance means
  // the fit is meaningless, and a weak fit on a short series is not worth
  // quoting to an operator as if it were a measurement.
  const elasticityByItem = new Map<
    string,
    { elasticity: number; confidence: "high" | "low" }
  >()
  for (const e of elasticityRows) {
    if (e.pricePointCount < 2) continue
    if (e.fitR2 < 0.1 || e.sampleSize < 14) continue
    // Positive coefficients are noise for a demand curve, not a finding.
    if (e.elasticity >= 0) continue
    const existing = elasticityByItem.get(e.otterItemSkuId)
    if (existing) continue
    elasticityByItem.set(e.otterItemSkuId, {
      elasticity: e.elasticity,
      confidence: e.fitR2 >= 0.4 && e.sampleSize >= 60 ? "high" : "low",
    })
  }
  const elasticityFor = (itemName: string) => elasticityByItem.get(itemName)

  const revenueByStatus = new Map<string, number>()
  for (const s of statusRollup) {
    revenueByStatus.set(String(s.status), s._sum.salesRevenue ?? 0)
  }
  const costedRevenue = revenueByStatus.get("COSTED") ?? 0
  const unmappedRevenue = revenueByStatus.get("UNMAPPED") ?? 0
  const missingCostRevenue = revenueByStatus.get("MISSING_COST") ?? 0
  const allRevenue = costedRevenue + unmappedRevenue + missingCostRevenue
  const coverage: MenuEngineeringCoverage = {
    costedRevenue,
    unmappedRevenue,
    missingCostRevenue,
    partialCostRevenue: partialAgg._sum.salesRevenue ?? 0,
    coveragePct: allRevenue > 0 ? (costedRevenue / allRevenue) * 100 : 100,
  }

  // One row per ITEM. This used to group by (itemName, category, recipeId)
  // and re-merge by (itemName, category), so an item the POS filed under two
  // categories was two dots with two margins; it is one item at one price,
  // which is how the catalog and the item page already count it.
  const rowsAll = [...economics.items.values()]
    .filter((i) => i.costed !== null)
    .map((i) => ({
      itemName: i.itemName,
      category: i.category,
      recipeId: i.recipeId,
      soldQty: i.costed!.units,
      revenue: i.costed!.collected,
      cogs: i.costed!.cost,
    }))

  // A display cut for the chart, not a definition: `menu` above is over
  // every costed item.
  const rowsRaw = rowsAll.filter((r) => r.soldQty >= minSoldQty)

  if (rowsRaw.length === 0) {
    return {
      ok: true,
      data: {
        storeId: input.storeId ?? null,
        storeName,
        windowStart,
        windowEnd,
        medianVelocity: 0,
        medianUnitMargin: 0,
        rows: [],
        counts: { STAR: 0, PLOWHORSE: 0, PUZZLE: 0, DOG: 0 },
        totalContribution: 0,
        coverage,
        menu: economics.menu,
      },
    }
  }

  const velocities = rowsRaw.map((r) => r.soldQty).sort((a, b) => a - b)
  const unitMargins = rowsRaw
    .map((r) => (r.soldQty > 0 ? (r.revenue - r.cogs) / r.soldQty : 0))
    .sort((a, b) => a - b)

  const medianVelocity = median(velocities)
  const medianUnitMargin = median(unitMargins)

  const counts: Record<MenuQuadrant, number> = {
    STAR: 0,
    PLOWHORSE: 0,
    PUZZLE: 0,
    DOG: 0,
  }
  let totalContribution = 0

  const rows: MenuEngineeringRow[] = rowsRaw.map((r) => {
    const unitPrice = r.soldQty > 0 ? r.revenue / r.soldQty : 0
    const unitCost = r.soldQty > 0 ? r.cogs / r.soldQty : 0
    const unitMargin = unitPrice - unitCost
    const totalC = r.revenue - r.cogs
    totalContribution += totalC
    const highVolume = r.soldQty >= medianVelocity
    const highMargin = unitMargin >= medianUnitMargin
    const quadrant: MenuQuadrant = highVolume
      ? highMargin
        ? "STAR"
        : "PLOWHORSE"
      : highMargin
        ? "PUZZLE"
        : "DOG"
    counts[quadrant] += 1
    return {
      itemName: r.itemName,
      category: r.category,
      recipeId: r.recipeId,
      soldQty: r.soldQty,
      revenue: r.revenue,
      cogs: r.cogs,
      unitPrice,
      unitCost,
      unitMargin,
      totalContribution: totalC,
      marginPct: r.revenue > 0 ? (totalC / r.revenue) * 100 : null,
      quadrant,
      elasticity: elasticityFor(r.itemName)?.elasticity ?? null,
      elasticityConfidence: elasticityFor(r.itemName)?.confidence ?? null,
    }
  })

  rows.sort((a, b) => b.totalContribution - a.totalContribution)

  return {
    ok: true,
    data: {
      storeId: input.storeId ?? null,
      storeName,
      windowStart,
      windowEnd,
      medianVelocity,
      medianUnitMargin,
      rows,
      counts,
      totalContribution,
      coverage,
      menu: economics.menu,
    },
  }
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2
  return sorted[mid]
}

