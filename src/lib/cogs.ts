import { prisma } from "@/lib/prisma"
import { salesRowValues, type OtterSummaryRow } from "@/lib/pnl"

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

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0)
}

async function salesRollup(
  storeId: string,
  startDate: Date,
  endDate: Date
): Promise<number> {
  const rows = await prisma.otterDailySummary.findMany({
    where: dateWindow(storeId, startDate, endDate),
    select: {
      platform: true,
      paymentMethod: true,
      fpGrossSales: true,
      tpGrossSales: true,
      fpTaxCollected: true,
      tpTaxCollected: true,
      fpDiscounts: true,
      tpDiscounts: true,
      fpServiceCharges: true,
      tpServiceCharges: true,
    },
  })
  return sum(salesRowValues(rows))
}

/** Internal: collapses DailyCogsItem plus OtterDailySummary to COGS metrics. */
async function rollup(storeId: string, startDate: Date, endDate: Date) {
  const where = dateWindow(storeId, startDate, endDate)
  const [agg, foodAgg, packagingAgg, revenueDollars] = await Promise.all([
    prisma.dailyCogsItem.aggregate({
      where,
      _sum: { lineCost: true, salesRevenue: true },
    }),
    prisma.dailyCogsItem.aggregate({
      where: { ...where, category: { not: "Packaging" } },
      _sum: { lineCost: true },
    }),
    prisma.dailyCogsItem.aggregate({
      where: { ...where, category: "Packaging" },
      _sum: { lineCost: true },
    }),
    salesRollup(storeId, startDate, endDate),
  ])
  const cogsDollars = agg._sum.lineCost ?? 0
  const costedRevenueDollars = agg._sum.salesRevenue ?? 0
  const foodCogsDollars = foodAgg._sum.lineCost ?? 0
  const packagingCogsDollars = packagingAgg._sum.lineCost ?? 0
  const cogsPct = revenueDollars > 0 ? (cogsDollars / revenueDollars) * 100 : 0
  return {
    cogsDollars,
    foodCogsDollars,
    packagingCogsDollars,
    revenueDollars,
    costedRevenueDollars,
    cogsPct,
  }
}

export interface CogsKpis {
  cogsPct: number
  cogsDollars: number
  foodCogsDollars: number
  packagingCogsDollars: number
  revenueDollars: number
  /** Revenue attached to materialized COGS rows; diagnostic coverage only. */
  costedRevenueDollars: number
  /** Percentage-points difference vs the prior-equivalent period. Null if prior had no revenue. */
  deltaVsPriorPp: number | null
  /** Percentage-points difference vs Store.targetCogsPct. Null if no target set. */
  deltaVsTargetPp: number | null
  targetCogsPct: number | null
}

export type CogsActionSeverity = "critical" | "warning" | "notice"
export type CogsActionSource = "data-quality" | "menu-item" | "ingredient" | "target"

export interface CogsActionItem {
  severity: CogsActionSeverity
  source: CogsActionSource
  title: string
  impactLabel: string
  href: string
  actionLabel: string
}

export interface CogsOperatorSummary {
  kpis: CogsKpis
  dataQuality: DataQualityCounts & {
    warningCount: number
    affectedRevenue: number
  }
  worstItems: WorstMarginRow[]
  actions: CogsActionItem[]
}

export interface CogsStoreOverviewRow {
  storeId: string
  storeName: string
  cogsPct: number
  cogsDollars: number
  foodCogsDollars: number
  packagingCogsDollars: number
  revenueDollars: number
  costedRevenueDollars: number
  targetCogsPct: number | null
  deltaVsTargetPp: number | null
  warningCount: number
}

export async function getCogsKpis(
  storeId: string,
  startDate: Date,
  endDate: Date
): Promise<CogsKpis> {
  const { priorStart, priorEnd } = priorWindow(startDate, endDate)
  const [current, store, prior] = await Promise.all([
    rollup(storeId, startDate, endDate),
    prisma.store.findUnique({
      where: { id: storeId },
      select: { targetCogsPct: true },
    }),
    rollup(storeId, priorStart, priorEnd),
  ])

  const deltaVsPriorPp =
    prior.revenueDollars > 0 ? current.cogsPct - prior.cogsPct : null
  const targetCogsPct = store?.targetCogsPct ?? null
  const deltaVsTargetPp =
    targetCogsPct != null ? current.cogsPct - targetCogsPct : null

  return {
    cogsPct: current.cogsPct,
    cogsDollars: current.cogsDollars,
    foodCogsDollars: current.foodCogsDollars,
    packagingCogsDollars: current.packagingCogsDollars,
    revenueDollars: current.revenueDollars,
    costedRevenueDollars: current.costedRevenueDollars,
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
  foodCogsDollars: number
  packagingCogsDollars: number
  revenueDollars: number
  costedRevenueDollars: number
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

  const [rows, summaries] = await Promise.all([
    prisma.dailyCogsItem.findMany({
      where: dateWindow(storeId, startDate, endDate),
      select: { date: true, category: true, lineCost: true, salesRevenue: true },
      orderBy: { date: "asc" },
    }),
    prisma.otterDailySummary.findMany({
      where: dateWindow(storeId, startDate, endDate),
      select: {
        date: true,
        platform: true,
        paymentMethod: true,
        fpGrossSales: true,
        tpGrossSales: true,
        fpTaxCollected: true,
        tpTaxCollected: true,
        fpDiscounts: true,
        tpDiscounts: true,
        fpServiceCharges: true,
        tpServiceCharges: true,
      },
      orderBy: { date: "asc" },
    }),
  ])

  const map = new Map<
    string,
    {
      cogs: number
      foodCogs: number
      packagingCogs: number
      costedRev: number
      summaries: OtterSummaryRow[]
    }
  >()

  // Pre-fill every bucket in range so the chart has continuous x-values.
  const cursor = new Date(startDate)
  cursor.setHours(0, 0, 0, 0)
  while (cursor < endDate) {
    map.set(bucketKeyOf(cursor), {
      cogs: 0,
      foodCogs: 0,
      packagingCogs: 0,
      costedRev: 0,
      summaries: [],
    })
    if (granularity === "daily") cursor.setDate(cursor.getDate() + 1)
    else if (granularity === "weekly") cursor.setDate(cursor.getDate() + 7)
    else cursor.setFullYear(cursor.getFullYear(), cursor.getMonth() + 1, 1)
  }

  for (const r of rows) {
    const k = bucketKeyOf(r.date)
    const cur = map.get(k) ?? {
      cogs: 0,
      foodCogs: 0,
      packagingCogs: 0,
      costedRev: 0,
      summaries: [],
    }
    cur.cogs += r.lineCost
    if (r.category === "Packaging") cur.packagingCogs += r.lineCost
    else cur.foodCogs += r.lineCost
    cur.costedRev += r.salesRevenue
    map.set(k, cur)
  }

  for (const summary of summaries) {
    const k = bucketKeyOf(summary.date)
    const cur = map.get(k) ?? {
      cogs: 0,
      foodCogs: 0,
      packagingCogs: 0,
      costedRev: 0,
      summaries: [],
    }
    cur.summaries.push(summary)
    map.set(k, cur)
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([bucket, v]) => {
      const revenueDollars = sum(salesRowValues(v.summaries))
      return {
        bucket,
        cogsDollars: v.cogs,
        foodCogsDollars: v.foodCogs,
        packagingCogsDollars: v.packagingCogs,
        revenueDollars,
        costedRevenueDollars: v.costedRev,
        cogsPct: revenueDollars > 0 ? (v.cogs / revenueDollars) * 100 : 0,
      }
    })
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
    where: { ...dateWindow(storeId, startDate, endDate), category: { not: "Packaging" } },
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
  /** Same store/date/item appears under multiple Otter categories. Informational source-data warning. */
  duplicateCategoryItems: number
  /** Count of rows where the recipe cost walk flagged at least one ingredient
   *  line uncostable. Can overlap with COSTED — a mostly-costed recipe that
   *  failed on one line still lands as COSTED + partialCost=true. */
  partialCost: number
}

export async function getDataQualityCounts(
  storeId: string,
  startDate: Date,
  endDate: Date
): Promise<DataQualityCounts> {
  const [byStatus, partialCount, duplicateCategoryRows] = await Promise.all([
    prisma.dailyCogsItem.groupBy({
      by: ["status"],
      where: dateWindow(storeId, startDate, endDate),
      _count: { _all: true },
    }),
    prisma.dailyCogsItem.count({
      where: { ...dateWindow(storeId, startDate, endDate), partialCost: true },
    }),
    prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS n
      FROM (
        SELECT "date", "itemName"
        FROM "DailyCogsItem"
        WHERE "storeId" = ${storeId}
          AND "date" >= ${startDate}
          AND "date" < ${endDate}
          AND "category" <> 'Packaging'
        GROUP BY "date", "itemName"
        HAVING COUNT(DISTINCT "category") > 1
      ) duplicate_categories
    `,
  ])
  const by = (s: "COSTED" | "UNMAPPED" | "MISSING_COST") =>
    byStatus.find((r) => r.status === s)?._count?._all ?? 0
  return {
    costed: by("COSTED"),
    unmapped: by("UNMAPPED"),
    missingCost: by("MISSING_COST"),
    duplicateCategoryItems: Number(duplicateCategoryRows[0]?.n ?? 0),
    partialCost: partialCount,
  }
}

async function getDataQualityImpact(
  storeId: string,
  startDate: Date,
  endDate: Date
) {
  const affected = await prisma.dailyCogsItem.aggregate({
    where: {
      ...dateWindow(storeId, startDate, endDate),
      OR: [
        { status: "UNMAPPED" },
        { status: "MISSING_COST" },
        { partialCost: true },
      ],
    },
    _sum: { salesRevenue: true },
  })

  return affected._sum.salesRevenue ?? 0
}

function formatMoneyBrief(value: number): string {
  const abs = Math.abs(value)
  const formatted = abs.toLocaleString("en-US", { maximumFractionDigits: 0 })
  return `${value < 0 ? "-" : ""}$${formatted}`
}

function formatPercentBrief(value: number): string {
  return `${value.toFixed(1)}%`
}

function buildCogsActions(input: {
  storeId: string
  kpis: CogsKpis
  dataQuality: CogsOperatorSummary["dataQuality"]
  worstItems: WorstMarginRow[]
}): CogsActionItem[] {
  const actions: CogsActionItem[] = []
  const { storeId, kpis, dataQuality, worstItems } = input

  if (dataQuality.unmapped > 0) {
    actions.push({
      severity: "critical",
      source: "data-quality",
      title: `${dataQuality.unmapped} sold item${dataQuality.unmapped === 1 ? "" : "s"} missing recipes`,
      impactLabel: `${formatMoneyBrief(dataQuality.affectedRevenue)} sales affected`,
      href: "/dashboard/recipes",
      actionLabel: "Build recipes",
    })
  }

  if (dataQuality.missingCost > 0 || dataQuality.partialCost > 0) {
    const count = dataQuality.missingCost + dataQuality.partialCost
    actions.push({
      severity: "critical",
      source: "data-quality",
      title: `${count} item${count === 1 ? "" : "s"} undercosted`,
      impactLabel: "Ingredient cost gaps",
      href: "/dashboard/ingredients",
      actionLabel: "Fix ingredients",
    })
  }

  if (dataQuality.duplicateCategoryItems > 0) {
    actions.push({
      severity: "notice",
      source: "data-quality",
      title: `${dataQuality.duplicateCategoryItems} item-day${dataQuality.duplicateCategoryItems === 1 ? "" : "s"} split across categories`,
      impactLabel: "Source category overlap",
      href: "/dashboard/cogs",
      actionLabel: "Audit categories",
    })
  }

  if (kpis.targetCogsPct == null) {
    actions.push({
      severity: "notice",
      source: "target",
      title: "No COGS target set",
      impactLabel: "Ranking by cost impact",
      href: `/dashboard/stores/${storeId}`,
      actionLabel: "Set target",
    })
  } else if (kpis.deltaVsTargetPp != null && kpis.deltaVsTargetPp > 0) {
    actions.push({
      severity: kpis.deltaVsTargetPp >= 3 ? "critical" : "warning",
      source: "target",
      title: `${formatPercentBrief(kpis.cogsPct)} COGS is over target`,
      impactLabel: `+${kpis.deltaVsTargetPp.toFixed(1)}pp vs target`,
      href: "#fix-first",
      actionLabel: "Review leak list",
    })
  }

  const worst = worstItems.find((item) => item.foodCostPct >= 35) ?? worstItems[0]
  if (worst) {
    actions.push({
      severity: worst.foodCostPct >= 45 ? "critical" : "warning",
      source: "menu-item",
      title: worst.itemName,
      impactLabel: `${formatPercentBrief(worst.foodCostPct)} food cost, ${formatMoneyBrief(worst.foodCostDollars)} cost`,
      href: worst.recipeId
        ? `/dashboard/recipes?recipeId=${worst.recipeId}`
        : "/dashboard/recipes",
      actionLabel: worst.recipeId ? "Open recipe" : "Map recipe",
    })
  }

  const severityRank: Record<CogsActionSeverity, number> = {
    critical: 0,
    warning: 1,
    notice: 2,
  }

  return actions
    .sort((a, b) => severityRank[a.severity] - severityRank[b.severity])
    .slice(0, 5)
}

export async function getCogsOperatorSummary(
  storeId: string,
  startDate: Date,
  endDate: Date
): Promise<CogsOperatorSummary> {
  const [kpis, dataQualityCounts, affectedRevenue, worstItems] =
    await Promise.all([
      getCogsKpis(storeId, startDate, endDate),
      getDataQualityCounts(storeId, startDate, endDate),
      getDataQualityImpact(storeId, startDate, endDate),
      getWorstMarginItems(storeId, startDate, endDate, 12),
    ])

  const dataQuality = {
    ...dataQualityCounts,
    warningCount:
      dataQualityCounts.unmapped +
      dataQualityCounts.missingCost +
      dataQualityCounts.partialCost +
      dataQualityCounts.duplicateCategoryItems,
    affectedRevenue,
  }

  return {
    kpis,
    dataQuality,
    worstItems,
    actions: buildCogsActions({
      storeId,
      kpis,
      dataQuality,
      worstItems,
    }),
  }
}

export async function getCogsStoreOverview(
  accountId: string,
  startDate: Date,
  endDate: Date
): Promise<CogsStoreOverviewRow[]> {
  const stores = await prisma.store.findMany({
    where: { accountId, isActive: true },
    select: { id: true, name: true, targetCogsPct: true },
    orderBy: { name: "asc" },
  })

  if (stores.length === 0) return []

  const storeIds = stores.map((store) => store.id)
  const [
    rollups,
    foodRollups,
    packagingRollups,
    statusCounts,
    partialCounts,
    duplicateCategoryCounts,
    summaries,
  ] = await Promise.all([
    prisma.dailyCogsItem.groupBy({
      by: ["storeId"],
      where: {
        storeId: { in: storeIds },
        date: { gte: startDate, lt: endDate },
      },
      _sum: { lineCost: true, salesRevenue: true },
    }),
    prisma.dailyCogsItem.groupBy({
      by: ["storeId"],
      where: {
        storeId: { in: storeIds },
        date: { gte: startDate, lt: endDate },
        category: { not: "Packaging" },
      },
      _sum: { lineCost: true },
    }),
    prisma.dailyCogsItem.groupBy({
      by: ["storeId"],
      where: {
        storeId: { in: storeIds },
        date: { gte: startDate, lt: endDate },
        category: "Packaging",
      },
      _sum: { lineCost: true },
    }),
    prisma.dailyCogsItem.groupBy({
      by: ["storeId", "status"],
      where: {
        storeId: { in: storeIds },
        date: { gte: startDate, lt: endDate },
      },
      _count: { _all: true },
    }),
    prisma.dailyCogsItem.groupBy({
      by: ["storeId"],
      where: {
        storeId: { in: storeIds },
        date: { gte: startDate, lt: endDate },
        partialCost: true,
      },
      _count: { _all: true },
    }),
    prisma.$queryRaw<Array<{ storeId: string; n: bigint }>>`
      SELECT "storeId", COUNT(*)::bigint AS n
      FROM (
        SELECT "storeId", "date", "itemName"
        FROM "DailyCogsItem"
        WHERE "storeId" = ANY(${storeIds}::text[])
          AND "date" >= ${startDate}
          AND "date" < ${endDate}
          AND "category" <> 'Packaging'
        GROUP BY "storeId", "date", "itemName"
        HAVING COUNT(DISTINCT "category") > 1
      ) duplicate_categories
      GROUP BY "storeId"
    `,
    prisma.otterDailySummary.findMany({
      where: {
        storeId: { in: storeIds },
        date: { gte: startDate, lt: endDate },
      },
      select: {
        storeId: true,
        platform: true,
        paymentMethod: true,
        fpGrossSales: true,
        tpGrossSales: true,
        fpTaxCollected: true,
        tpTaxCollected: true,
        fpDiscounts: true,
        tpDiscounts: true,
        fpServiceCharges: true,
        tpServiceCharges: true,
      },
    }),
  ])

  const rollupByStore = new Map(rollups.map((row) => [row.storeId, row]))
  const foodByStore = new Map(foodRollups.map((row) => [row.storeId, row]))
  const packagingByStore = new Map(packagingRollups.map((row) => [row.storeId, row]))
  const partialByStore = new Map(
    partialCounts.map((row) => [row.storeId, row._count._all])
  )
  const duplicateCategoryByStore = new Map(
    duplicateCategoryCounts.map((row) => [row.storeId, Number(row.n)])
  )
  const summariesByStore = new Map<string, OtterSummaryRow[]>()
  for (const summary of summaries) {
    const bucket = summariesByStore.get(summary.storeId) ?? []
    bucket.push(summary)
    summariesByStore.set(summary.storeId, bucket)
  }

  function countStatus(storeId: string, status: "UNMAPPED" | "MISSING_COST") {
    return (
      statusCounts.find((row) => row.storeId === storeId && row.status === status)
        ?._count._all ?? 0
    )
  }

  const rows = stores.map((store) => {
    const rollup = rollupByStore.get(store.id)
    const cogsDollars = rollup?._sum.lineCost ?? 0
    const foodCogsDollars = foodByStore.get(store.id)?._sum.lineCost ?? 0
    const packagingCogsDollars = packagingByStore.get(store.id)?._sum.lineCost ?? 0
    const costedRevenueDollars = rollup?._sum.salesRevenue ?? 0
    const revenueDollars = sum(salesRowValues(summariesByStore.get(store.id) ?? []))
    const cogsPct = revenueDollars > 0 ? (cogsDollars / revenueDollars) * 100 : 0
    const targetCogsPct = store.targetCogsPct ?? null
    const deltaVsTargetPp =
      targetCogsPct != null && revenueDollars > 0 ? cogsPct - targetCogsPct : null

    return {
      storeId: store.id,
      storeName: store.name,
      cogsPct,
      cogsDollars,
      foodCogsDollars,
      packagingCogsDollars,
      revenueDollars,
      costedRevenueDollars,
      targetCogsPct,
      deltaVsTargetPp,
      warningCount:
        countStatus(store.id, "UNMAPPED") +
        countStatus(store.id, "MISSING_COST") +
        (partialByStore.get(store.id) ?? 0) +
        (duplicateCategoryByStore.get(store.id) ?? 0),
    }
  })

  return rows.sort((a, b) => {
    const aOver = a.deltaVsTargetPp != null && a.deltaVsTargetPp > 0 ? 1 : 0
    const bOver = b.deltaVsTargetPp != null && b.deltaVsTargetPp > 0 ? 1 : 0
    if (aOver !== bOver) return bOver - aOver
    if (a.warningCount !== b.warningCount) return b.warningCount - a.warningCount
    return b.cogsDollars - a.cogsDollars
  })
}
