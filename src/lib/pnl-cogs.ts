import { prisma } from "@/lib/prisma"
import { computeRecipeCost } from "@/lib/recipe-cost"
import type { Period } from "@/lib/pnl"

export type UnmappedMenuItem = {
  itemName: string
  category: string
  qtySold: number
  salesRevenue: number
}

export type PeriodCogs = {
  cogsValues: number[]
  unmappedItems: UnmappedMenuItem[]
  /** How many menu-item rows resolved to a recipe. Useful for UI disclosure. */
  mappedRowCount: number
  /** How many resolved to a recipe that currently has no computable cost. */
  missingCostRowCount: number
}

/**
 * Compute period-matched COGS per period for one store.
 *
 * For each day × each menu item in the period, find the mapped Recipe (via
 * OtterItemMapping first, then exact-name fallback to owner-level Recipe),
 * compute the recipe cost as of the period's end date, and multiply by units
 * sold.
 */
export async function computeCogsForPeriods(input: {
  storeId: string
  ownerId: string
  periods: Period[]
}): Promise<PeriodCogs> {
  const { storeId, ownerId, periods } = input

  if (periods.length === 0) {
    return {
      cogsValues: [],
      unmappedItems: [],
      mappedRowCount: 0,
      missingCostRowCount: 0,
    }
  }

  const rangeStart = periods[0].startDate
  const rangeEnd = periods[periods.length - 1].endDate

  const [menuRows, mappings, recipes] = await Promise.all([
    prisma.otterMenuItem.findMany({
      where: {
        storeId,
        isModifier: false,
        date: { gte: rangeStart, lte: rangeEnd },
      },
      select: {
        date: true,
        itemName: true,
        category: true,
        fpQuantitySold: true,
        tpQuantitySold: true,
        fpTotalSales: true,
        tpTotalSales: true,
      },
    }),
    prisma.otterItemMapping.findMany({
      where: { storeId },
      select: { otterItemName: true, recipeId: true },
    }),
    prisma.recipe.findMany({
      where: { ownerId },
      select: { id: true, itemName: true },
    }),
  ])

  const mappingByName = new Map(
    mappings.map((m) => [m.otterItemName, m.recipeId])
  )
  const recipeByName = new Map(
    recipes.map((r) => [r.itemName.toLowerCase(), r.id])
  )

  const cogsValues = periods.map(() => 0)
  const unmappedAgg = new Map<string, UnmappedMenuItem>()
  const costCache = new Map<string, number | null>() // `${recipeId}::${periodIdx}` → cost

  let mappedRowCount = 0
  let missingCostRowCount = 0

  async function costFor(recipeId: string, periodIdx: number): Promise<number | null> {
    const key = `${recipeId}::${periodIdx}`
    if (costCache.has(key)) return costCache.get(key)!
    const asOf = periods[periodIdx].endDate
    try {
      const result = await computeRecipeCost(recipeId, asOf)
      costCache.set(key, result.totalCost)
      return result.totalCost
    } catch {
      costCache.set(key, null)
      return null
    }
  }

  for (const row of menuRows) {
    const recipeId =
      mappingByName.get(row.itemName) ??
      recipeByName.get(row.itemName.toLowerCase()) ??
      null

    const qty = (row.fpQuantitySold ?? 0) + (row.tpQuantitySold ?? 0)
    const revenue = (row.fpTotalSales ?? 0) + (row.tpTotalSales ?? 0)

    if (!recipeId) {
      const key = `${row.itemName}:::${row.category}`
      const existing = unmappedAgg.get(key)
      if (existing) {
        existing.qtySold += qty
        existing.salesRevenue += revenue
      } else {
        unmappedAgg.set(key, {
          itemName: row.itemName,
          category: row.category,
          qtySold: qty,
          salesRevenue: revenue,
        })
      }
      continue
    }

    const periodIdx = findPeriodIndex(row.date, periods)
    if (periodIdx === -1) continue

    const cost = await costFor(recipeId, periodIdx)
    mappedRowCount++
    if (cost == null || cost === 0) {
      missingCostRowCount++
      continue
    }

    cogsValues[periodIdx] += qty * cost
  }

  return {
    cogsValues,
    unmappedItems: Array.from(unmappedAgg.values()).sort(
      (a, b) => b.salesRevenue - a.salesRevenue
    ),
    mappedRowCount,
    missingCostRowCount,
  }
}

function findPeriodIndex(date: Date, periods: Period[]): number {
  const t = date.getTime()
  return periods.findIndex(
    (p) => t >= p.startDate.getTime() && t <= p.endDate.getTime()
  )
}
