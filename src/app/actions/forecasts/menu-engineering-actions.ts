"use server"

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
}

export type GetMenuEngineeringResult =
  | { ok: true; data: MenuEngineeringData }
  | { ok: false; error: "store_not_in_account" }

export async function getMenuEngineering(input: {
  /** Omit to roll across all stores the caller owns. */
  storeId?: string
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

  const [grouped, statusRollup, partialAgg] = await Promise.all([
    prisma.dailyCogsItem.groupBy({
      by: ["itemName", "category", "recipeId"],
      where: { ...windowWhere, status: "COSTED" },
      _sum: { qtySold: true, salesRevenue: true, lineCost: true },
    }),
    prisma.dailyCogsItem.groupBy({
      by: ["status"],
      where: windowWhere,
      _sum: { qtySold: true, salesRevenue: true },
    }),
    prisma.dailyCogsItem.aggregate({
      where: { ...windowWhere, status: "COSTED", partialCost: true },
      _sum: { salesRevenue: true },
    }),
  ])

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

  // Re-merge by (itemName, category): grouping by recipeId can split an item
  // that was remapped mid-window into two rows. Keep the highest-qty recipeId.
  const mergedByKey = new Map<
    string,
    { itemName: string; category: string; recipeId: string | null; recipeQty: number; soldQty: number; revenue: number; cogs: number }
  >()
  for (const row of grouped) {
    const soldQty = row._sum.qtySold ?? 0
    const revenue = row._sum.salesRevenue ?? 0
    const cogs = row._sum.lineCost ?? 0
    const key = `${row.itemName}:::${row.category}`
    const existing = mergedByKey.get(key)
    if (!existing) {
      mergedByKey.set(key, {
        itemName: row.itemName,
        category: row.category,
        recipeId: row.recipeId ?? null,
        recipeQty: soldQty,
        soldQty,
        revenue,
        cogs,
      })
      continue
    }
    existing.soldQty += soldQty
    existing.revenue += revenue
    existing.cogs += cogs
    if (soldQty > existing.recipeQty && row.recipeId) {
      existing.recipeId = row.recipeId
      existing.recipeQty = soldQty
    }
  }

  const rowsRaw = Array.from(mergedByKey.values()).filter(
    (r) => r.soldQty >= minSoldQty
  )

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
    },
  }
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2
  return sorted[mid]
}

