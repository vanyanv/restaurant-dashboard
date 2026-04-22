import { prisma } from "@/lib/prisma"
import { computeRecipeCost } from "@/lib/recipe-cost"

/** Internal: end-exclusive Prisma where for a date window. */
function dateWindow(storeId: string, startDate: Date, endDate: Date) {
  return { storeId, date: { gte: startDate, lt: endDate } }
}

/** Internal: prior-equivalent window (same span, immediately before). */
function priorWindow(startDate: Date, endDate: Date) {
  const span = endDate.getTime() - startDate.getTime()
  const priorEnd = new Date(startDate.getTime())
  const priorStart = new Date(startDate.getTime() - span)
  return { priorStart, priorEnd }
}

/** Internal: collapses a list of DailyCogsItem to ($cogs, $revenue, %). */
async function rollup(where: { storeId: string; date: { gte: Date; lt: Date } }) {
  const agg = await prisma.dailyCogsItem.aggregate({
    where,
    _sum: { lineCost: true, salesRevenue: true },
  })
  const cogsDollars = agg._sum.lineCost ?? 0
  const revenueDollars = agg._sum.salesRevenue ?? 0
  const cogsPct = revenueDollars > 0 ? (cogsDollars / revenueDollars) * 100 : 0
  return { cogsDollars, revenueDollars, cogsPct }
}

export interface CogsKpis {
  cogsPct: number
  cogsDollars: number
  revenueDollars: number
  /** Percentage-points difference vs the prior-equivalent period. Null if prior had no revenue. */
  deltaVsPriorPp: number | null
  /** Percentage-points difference vs Store.targetCogsPct. Null if no target set. */
  deltaVsTargetPp: number | null
  targetCogsPct: number | null
}

export async function getCogsKpis(
  storeId: string,
  startDate: Date,
  endDate: Date
): Promise<CogsKpis> {
  const { priorStart, priorEnd } = priorWindow(startDate, endDate)
  const [current, store, prior] = await Promise.all([
    rollup(dateWindow(storeId, startDate, endDate)),
    prisma.store.findUnique({
      where: { id: storeId },
      select: { targetCogsPct: true },
    }),
    rollup(dateWindow(storeId, priorStart, priorEnd)),
  ])

  const deltaVsPriorPp =
    prior.revenueDollars > 0 ? current.cogsPct - prior.cogsPct : null
  const targetCogsPct = store?.targetCogsPct ?? null
  const deltaVsTargetPp =
    targetCogsPct != null ? current.cogsPct - targetCogsPct : null

  return {
    cogsPct: current.cogsPct,
    cogsDollars: current.cogsDollars,
    revenueDollars: current.revenueDollars,
    deltaVsPriorPp,
    deltaVsTargetPp,
    targetCogsPct,
  }
}

export type Granularity = "daily" | "weekly" | "monthly"

export interface CogsTrendBucket {
  /** ISO date string at the start of the bucket (local midnight, store TZ irrelevant for v1). */
  bucket: string
  cogsDollars: number
  revenueDollars: number
  cogsPct: number
}

/**
 * Returns one row per bucket in [startDate, endDate). Empty buckets are
 * present with 0/0/0 so the chart line is continuous.
 */
export async function getCogsTrend(
  storeId: string,
  startDate: Date,
  endDate: Date,
  granularity: Granularity
): Promise<CogsTrendBucket[]> {
  const rows = await prisma.dailyCogsItem.findMany({
    where: dateWindow(storeId, startDate, endDate),
    select: { date: true, lineCost: true, salesRevenue: true },
    orderBy: { date: "asc" },
  })

  // Bucket key = ISO date string at the start of the bucket.
  const bucketKeyOf = (d: Date) => {
    const dt = new Date(d)
    if (granularity === "daily") {
      // Already a day.
    } else if (granularity === "weekly") {
      // Snap to Monday (ISO week start).
      const dow = (dt.getDay() + 6) % 7 // 0 = Mon
      dt.setDate(dt.getDate() - dow)
    } else {
      // monthly
      dt.setDate(1)
    }
    dt.setHours(0, 0, 0, 0)
    return dt.toISOString().slice(0, 10)
  }

  const map = new Map<string, { cogs: number; rev: number }>()

  // Pre-fill every bucket in range so the chart has continuous x-values.
  const cursor = new Date(startDate)
  cursor.setHours(0, 0, 0, 0)
  while (cursor < endDate) {
    map.set(bucketKeyOf(cursor), { cogs: 0, rev: 0 })
    if (granularity === "daily") cursor.setDate(cursor.getDate() + 1)
    else if (granularity === "weekly") cursor.setDate(cursor.getDate() + 7)
    else cursor.setFullYear(cursor.getFullYear(), cursor.getMonth() + 1, 1)
  }

  for (const r of rows) {
    const k = bucketKeyOf(r.date)
    const cur = map.get(k) ?? { cogs: 0, rev: 0 }
    cur.cogs += r.lineCost
    cur.rev += r.salesRevenue
    map.set(k, cur)
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([bucket, v]) => ({
      bucket,
      cogsDollars: v.cogs,
      revenueDollars: v.rev,
      cogsPct: v.rev > 0 ? (v.cogs / v.rev) * 100 : 0,
    }))
}

export interface CategoryBreakdown {
  category: string
  cogsDollars: number
  pctOfCogs: number
}

export async function getCostByCategory(
  storeId: string,
  startDate: Date,
  endDate: Date
): Promise<CategoryBreakdown[]> {
  const rows = await prisma.dailyCogsItem.groupBy({
    by: ["category"],
    where: dateWindow(storeId, startDate, endDate),
    _sum: { lineCost: true },
  })
  const total = rows.reduce((acc, r) => acc + (r._sum.lineCost ?? 0), 0)
  return rows
    .map((r) => ({
      category: r.category || "(uncategorized)",
      cogsDollars: r._sum.lineCost ?? 0,
      pctOfCogs: total > 0 ? ((r._sum.lineCost ?? 0) / total) * 100 : 0,
    }))
    .sort((a, b) => b.cogsDollars - a.cogsDollars)
}

export interface WorstMarginRow {
  itemName: string
  recipeId: string | null
  unitsSold: number
  revenue: number
  foodCostDollars: number
  /** Food cost % of revenue. Items with revenue=0 are excluded. */
  foodCostPct: number
}

export async function getWorstMarginItems(
  storeId: string,
  startDate: Date,
  endDate: Date,
  limit: number
): Promise<WorstMarginRow[]> {
  const rows = await prisma.dailyCogsItem.groupBy({
    by: ["itemName", "recipeId"],
    where: dateWindow(storeId, startDate, endDate),
    _sum: { qtySold: true, salesRevenue: true, lineCost: true },
  })
  return rows
    .map((r) => {
      const revenue = r._sum.salesRevenue ?? 0
      const cost = r._sum.lineCost ?? 0
      return {
        itemName: r.itemName,
        recipeId: r.recipeId,
        unitsSold: r._sum.qtySold ?? 0,
        revenue,
        foodCostDollars: cost,
        foodCostPct: revenue > 0 ? (cost / revenue) * 100 : 0,
      }
    })
    .filter((r) => r.revenue > 0) // hide zero-revenue noise
    .sort((a, b) => b.foodCostPct - a.foodCostPct)
    .slice(0, limit)
}

export interface DataQualityCounts {
  costed: number
  unmapped: number
  missingCost: number
}

export async function getDataQualityCounts(
  storeId: string,
  startDate: Date,
  endDate: Date
): Promise<DataQualityCounts> {
  const rows = await prisma.dailyCogsItem.groupBy({
    by: ["status"],
    where: dateWindow(storeId, startDate, endDate),
    _count: { _all: true },
  })
  const by = (s: "COSTED" | "UNMAPPED" | "MISSING_COST") =>
    rows.find((r) => r.status === s)?._count?._all ?? 0
  return {
    costed: by("COSTED"),
    unmapped: by("UNMAPPED"),
    missingCost: by("MISSING_COST"),
  }
}
