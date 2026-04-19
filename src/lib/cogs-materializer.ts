import { prisma } from "@/lib/prisma"
import { computeRecipeCost, type RecipeCostResult } from "@/lib/recipe-cost"
import { CogsStatus } from "@/generated/prisma/client"

/**
 * Compute and upsert DailyCogsItem rows for one (storeId, date).
 *
 * Deletes any existing rows for that day first, then recomputes from
 * OtterMenuItem + OtterItemMapping + Recipe. Uses an outer recipe-cost
 * memo so each unique recipe is walked once per day even if multiple
 * menu rows map to it.
 *
 * `asOf` for recipe cost is the sale date itself — more accurate than the
 * previous per-request code which used period-end as asOf.
 */
export async function recomputeDailyCogsForDay(input: {
  storeId: string
  date: Date
  ownerId: string
}): Promise<{ rowsWritten: number }> {
  const { storeId, ownerId } = input
  const date = startOfDayUTC(input.date)

  const dayEnd = new Date(date)
  dayEnd.setUTCHours(23, 59, 59, 999)

  const [menuRows, mappings, recipes] = await Promise.all([
    prisma.otterMenuItem.findMany({
      where: {
        storeId,
        isModifier: false,
        date: { gte: date, lte: dayEnd },
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

  const mappingByName = new Map(mappings.map((m) => [m.otterItemName, m.recipeId]))
  const recipeByName = new Map(recipes.map((r) => [r.itemName.toLowerCase(), r.id]))

  const recipeCostCache = new Map<string, Promise<RecipeCostResult | null>>()

  function costFor(recipeId: string): Promise<RecipeCostResult | null> {
    const existing = recipeCostCache.get(recipeId)
    if (existing) return existing
    const p = computeRecipeCost(recipeId, date).catch(() => null)
    recipeCostCache.set(recipeId, p)
    return p
  }

  const rows = await Promise.all(
    menuRows.map(async (row) => {
      const qty = (row.fpQuantitySold ?? 0) + (row.tpQuantitySold ?? 0)
      const revenue = (row.fpTotalSales ?? 0) + (row.tpTotalSales ?? 0)

      const recipeId =
        mappingByName.get(row.itemName) ??
        recipeByName.get(row.itemName.toLowerCase()) ??
        null

      if (!recipeId) {
        return {
          storeId,
          date,
          itemName: row.itemName,
          category: row.category,
          recipeId: null,
          qtySold: qty,
          salesRevenue: revenue,
          unitCost: null,
          lineCost: 0,
          status: CogsStatus.UNMAPPED,
        }
      }

      const result = await costFor(recipeId)
      const totalCost = result?.totalCost ?? null
      const hasCost = totalCost != null && totalCost > 0
      return {
        storeId,
        date,
        itemName: row.itemName,
        category: row.category,
        recipeId,
        qtySold: qty,
        salesRevenue: revenue,
        unitCost: hasCost ? totalCost : null,
        lineCost: hasCost ? totalCost * qty : 0,
        status: hasCost ? CogsStatus.COSTED : CogsStatus.MISSING_COST,
      }
    })
  )

  await prisma.$transaction([
    prisma.dailyCogsItem.deleteMany({ where: { storeId, date } }),
    prisma.dailyCogsItem.createMany({ data: rows, skipDuplicates: true }),
  ])

  return { rowsWritten: rows.length }
}

/**
 * Recompute every day in [startDate, endDate] for one store. Iterates
 * sequentially per day so `recomputeDailyCogsForDay`'s in-memory cache
 * stays scoped; cross-day reuse is small (different `asOf` per day).
 */
export async function recomputeDailyCogsForRange(input: {
  storeId: string
  startDate: Date
  endDate: Date
  ownerId: string
}): Promise<{ daysProcessed: number; rowsWritten: number }> {
  const start = startOfDayUTC(input.startDate)
  const end = startOfDayUTC(input.endDate)

  let daysProcessed = 0
  let rowsWritten = 0

  for (
    let cursor = new Date(start);
    cursor.getTime() <= end.getTime();
    cursor = addDaysUTC(cursor, 1)
  ) {
    const { rowsWritten: n } = await recomputeDailyCogsForDay({
      storeId: input.storeId,
      date: cursor,
      ownerId: input.ownerId,
    })
    daysProcessed++
    rowsWritten += n
  }

  return { daysProcessed, rowsWritten }
}

/**
 * Find (storeId, date) pairs within the lookback window that have OtterMenuItem
 * rows but no DailyCogsItem rows, and refill them. This is what the Otter sync
 * route calls at the end of its menu-items phase; it also picks up days that
 * were invalidated (rows deleted) by an upstream mutation.
 */
export async function refreshStaleDailyCogs(input: {
  ownerId: string
  lookbackDays?: number
}): Promise<{ daysProcessed: number; rowsWritten: number }> {
  const lookbackDays = input.lookbackDays ?? 90
  const cutoff = startOfDayUTC(new Date())
  cutoff.setUTCDate(cutoff.getUTCDate() - lookbackDays)

  const stores = await prisma.store.findMany({
    where: { ownerId: input.ownerId, isActive: true },
    select: { id: true },
  })
  if (stores.length === 0) return { daysProcessed: 0, rowsWritten: 0 }

  const storeIds = stores.map((s) => s.id)

  // Days with menu rows in the window, grouped by (storeId, date).
  const menuDays = await prisma.otterMenuItem.groupBy({
    by: ["storeId", "date"],
    where: {
      storeId: { in: storeIds },
      isModifier: false,
      date: { gte: cutoff },
    },
  })

  // Days that already have a DailyCogsItem row (any row → day considered fresh).
  const cogsDays = await prisma.dailyCogsItem.groupBy({
    by: ["storeId", "date"],
    where: {
      storeId: { in: storeIds },
      date: { gte: cutoff },
    },
  })

  const have = new Set(cogsDays.map((r) => `${r.storeId}::${dateKey(r.date)}`))
  const missing = menuDays.filter(
    (r) => !have.has(`${r.storeId}::${dateKey(r.date)}`)
  )

  let daysProcessed = 0
  let rowsWritten = 0

  for (const { storeId, date } of missing) {
    const { rowsWritten: n } = await recomputeDailyCogsForDay({
      storeId,
      date,
      ownerId: input.ownerId,
    })
    daysProcessed++
    rowsWritten += n
  }

  return { daysProcessed, rowsWritten }
}

function startOfDayUTC(d: Date): Date {
  const n = new Date(d)
  n.setUTCHours(0, 0, 0, 0)
  return n
}

function addDaysUTC(d: Date, n: number): Date {
  const r = new Date(d)
  r.setUTCDate(r.getUTCDate() + n)
  return r
}

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}
