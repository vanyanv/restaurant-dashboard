"use server"

// Forward food cost % forecast. Joins:
//   - ForecastDailyRevenue (latest generation per date)
//   - ForecastMenuItem    (latest generation per (sku, date))
//   - OtterItemMapping    (otterItemName → recipeId per store)
//   - computeRecipeCost   (recipe → totalCost, recursive sub-recipe walk)
//
// Returns one row per day: predicted revenue, predicted food cost,
// food cost %, plus pessimistic / optimistic % bounds derived from the
// p10/p90 spread on each input.

import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { computeRecipeCost } from "@/lib/recipe-cost"

interface SessionUser {
  id: string
  accountId: string
}
interface SessionLike {
  user?: SessionUser | null
}

export interface FoodCostForecastDay {
  date: Date
  predictedRevenue: number | null
  predictedFoodCost: number
  foodCostPct: number | null
  /** Worst-case % (high cost band ÷ low revenue band). */
  pctP90: number | null
  /** Best-case % (low cost band ÷ high revenue band). */
  pctP10: number | null
  /** Number of forecasted-item lines that day with no OtterItemMapping. */
  unmappedItemCount: number
  /** True when at least one recipe cost was partial (missing ingredient cost). */
  partialRecipeCost: boolean
}

export interface FoodCostForecastData {
  storeId: string
  storeName: string
  generatedAt: Date | null
  days: FoodCostForecastDay[]
  /** Total predicted revenue / food cost / blended % over the horizon. */
  totalPredictedRevenue: number
  totalPredictedFoodCost: number
  blendedFoodCostPct: number | null
}

export type GetFoodCostForecastResult =
  | { ok: true; data: FoodCostForecastData }
  | { ok: false; error: "store_not_in_account" }

export async function getFoodCostForecast(input: {
  storeId: string
  horizonDays?: number
  asOf?: Date
}): Promise<GetFoodCostForecastResult | null> {
  const session = (await getServerSession(authOptions)) as SessionLike | null
  const user = session?.user ?? null
  if (!user) return null

  const store = await prisma.store.findUnique({
    where: { id: input.storeId },
    select: { id: true, name: true, accountId: true },
  })
  if (!store || store.accountId !== user.accountId) {
    return { ok: false, error: "store_not_in_account" }
  }

  const horizonDays = input.horizonDays ?? 7
  const asOf = input.asOf ?? new Date()
  const horizonEnd = new Date(asOf)
  horizonEnd.setDate(horizonEnd.getDate() + horizonDays)
  const dayStart = startOfDay(asOf)
  const dayEnd = startOfDay(horizonEnd)

  const [revenueRows, menuRows, mappings] = await Promise.all([
    prisma.forecastDailyRevenue.findMany({
      where: {
        storeId: input.storeId,
        hourBucket: 0,
        forecastDate: { gte: dayStart, lt: dayEnd },
      },
      orderBy: [{ forecastDate: "asc" }, { generatedAt: "desc" }],
      select: {
        forecastDate: true,
        predictedRevenue: true,
        p10: true,
        p90: true,
        generatedAt: true,
      },
    }),
    prisma.forecastMenuItem.findMany({
      where: {
        storeId: input.storeId,
        forecastDate: { gte: dayStart, lt: dayEnd },
      },
      orderBy: [{ otterItemSkuId: "asc" }, { forecastDate: "asc" }, { generatedAt: "desc" }],
      select: {
        otterItemSkuId: true,
        forecastDate: true,
        predictedQty: true,
        p10: true,
        p90: true,
        generatedAt: true,
      },
    }),
    prisma.otterItemMapping.findMany({
      where: { storeId: input.storeId },
      select: { otterItemName: true, recipeId: true },
    }),
  ])

  // Latest generation per (date) for revenue and per (sku, date) for menu
  type RevenueRow = (typeof revenueRows)[number]
  type MenuRow = (typeof menuRows)[number]
  const latestRevenue = new Map<string, RevenueRow>()
  for (const r of revenueRows) {
    const key = ymd(r.forecastDate as Date)
    const existing = latestRevenue.get(key)
    if (!existing || r.generatedAt > existing.generatedAt) latestRevenue.set(key, r)
  }
  const latestMenu = new Map<string, MenuRow>()
  for (const r of menuRows) {
    const key = `${r.otterItemSkuId}|${ymd(r.forecastDate as Date)}`
    const existing = latestMenu.get(key)
    if (!existing || r.generatedAt > existing.generatedAt) latestMenu.set(key, r)
  }

  const recipeIdByItemName = new Map(
    mappings.map((m) => [m.otterItemName, m.recipeId]),
  )
  const recipeCostCache = new Map<string, { totalCost: number; partial: boolean }>()
  async function getRecipeUnitCost(recipeId: string) {
    const cached = recipeCostCache.get(recipeId)
    if (cached) return cached
    try {
      const r = await computeRecipeCost(recipeId, asOf, { storeId: input.storeId })
      const value = { totalCost: r.totalCost, partial: r.partial }
      recipeCostCache.set(recipeId, value)
      return value
    } catch {
      const value = { totalCost: 0, partial: true }
      recipeCostCache.set(recipeId, value)
      return value
    }
  }

  // Bucket menu rows by date
  const menuByDate = new Map<string, MenuRow[]>()
  for (const r of latestMenu.values()) {
    const key = ymd(r.forecastDate as Date)
    const list = menuByDate.get(key) ?? []
    list.push(r)
    menuByDate.set(key, list)
  }

  // Accumulate per-day rollups. Use the union of revenue + menu dates so we
  // surface a row even when one side has data and the other doesn't.
  const allDates = new Set<string>([...latestRevenue.keys(), ...menuByDate.keys()])
  const sortedDates = Array.from(allDates).sort()

  const days: FoodCostForecastDay[] = []
  let latestGen: Date | null = null
  let totalRevenue = 0
  let totalFoodCost = 0

  for (const dateKey of sortedDates) {
    const revenueRow = latestRevenue.get(dateKey) ?? null
    const items = menuByDate.get(dateKey) ?? []

    let foodCost = 0
    let foodCostP10 = 0
    let foodCostP90 = 0
    let unmappedItemCount = 0
    let partialRecipeCost = false

    for (const item of items) {
      const recipeId = recipeIdByItemName.get(item.otterItemSkuId)
      if (!recipeId) {
        unmappedItemCount += 1
        continue
      }
      const recipeCost = await getRecipeUnitCost(recipeId)
      if (recipeCost.partial) partialRecipeCost = true
      foodCost += item.predictedQty * recipeCost.totalCost
      foodCostP10 += (item.p10 ?? item.predictedQty) * recipeCost.totalCost
      foodCostP90 += (item.p90 ?? item.predictedQty) * recipeCost.totalCost
    }

    if (revenueRow && revenueRow.generatedAt && (!latestGen || revenueRow.generatedAt > latestGen)) {
      latestGen = revenueRow.generatedAt
    }

    const predictedRevenue = revenueRow?.predictedRevenue ?? null
    const revP10 = revenueRow?.p10 ?? predictedRevenue
    const revP90 = revenueRow?.p90 ?? predictedRevenue

    const foodCostPct =
      predictedRevenue && predictedRevenue > 0 ? foodCost / predictedRevenue : null
    const pctP10 =
      revP90 && revP90 > 0 ? foodCostP10 / revP90 : null
    const pctP90 =
      revP10 && revP10 > 0 ? foodCostP90 / revP10 : null

    days.push({
      date: new Date(`${dateKey}T00:00:00.000Z`),
      predictedRevenue,
      predictedFoodCost: foodCost,
      foodCostPct,
      pctP10,
      pctP90,
      unmappedItemCount,
      partialRecipeCost,
    })

    totalRevenue += predictedRevenue ?? 0
    totalFoodCost += foodCost
  }

  return {
    ok: true,
    data: {
      storeId: store.id,
      storeName: store.name,
      generatedAt: latestGen,
      days,
      totalPredictedRevenue: totalRevenue,
      totalPredictedFoodCost: totalFoodCost,
      blendedFoodCostPct: totalRevenue > 0 ? totalFoodCost / totalRevenue : null,
    },
  }
}

function startOfDay(d: Date): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  return out
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}
