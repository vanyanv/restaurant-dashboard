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

import { prisma } from "@/lib/prisma"
import { computeRecipeCost } from "@/lib/recipe-cost"
import { batchRecipeCosts } from "@/lib/recipe-cost-batch"
import {
  defaultForecastPreference,
  isReconciledStale,
  type ForecastSourcePreference,
} from "@/lib/forecasts/reconciliation-prefs"
import { getCachedSession, resolveStoreContext } from "./_shared"

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
  /** Null when aggregating across all stores in the account. */
  storeId: string | null
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
  storeId?: string
  horizonDays?: number
  asOf?: Date
  /** W6-8: forwards to revenue + menu-item reads. 'reconciled' uses
   *  reconciledRevenue / reconciledQty when present and fresh. */
  prefer?: ForecastSourcePreference
}): Promise<GetFoodCostForecastResult | null> {
  const session = await getCachedSession()
  const user = session?.user ?? null
  if (!user) return null

  const resolved = await resolveStoreContext(input.storeId, user.accountId)
  if (!resolved.ok) return resolved
  const { storeIds, storeName, storeIdOut } = resolved.ctx

  const prefer = input.prefer ?? defaultForecastPreference()
  const horizonDays = input.horizonDays ?? 7
  const asOf = input.asOf ?? new Date()
  const horizonEnd = new Date(asOf)
  horizonEnd.setDate(horizonEnd.getDate() + horizonDays)
  const dayStart = startOfDay(asOf)
  const dayEnd = startOfDay(horizonEnd)

  const [revenueRows, menuRows, mappings] = await Promise.all([
    prisma.forecastDailyRevenue.findMany({
      where: {
        storeId: { in: storeIds },
        hourBucket: 0,
        forecastDate: { gte: dayStart, lt: dayEnd },
      },
      select: {
        storeId: true,
        forecastDate: true,
        predictedRevenue: true,
        p10: true,
        p90: true,
        generatedAt: true,
        reconciledRevenue: true,
        reconciledP10: true,
        reconciledP90: true,
        reconciledAt: true,
      },
    }),
    prisma.forecastMenuItem.findMany({
      where: {
        storeId: { in: storeIds },
        forecastDate: { gte: dayStart, lt: dayEnd },
      },
      select: {
        storeId: true,
        otterItemSkuId: true,
        forecastDate: true,
        predictedQty: true,
        p10: true,
        p90: true,
        generatedAt: true,
        reconciledQty: true,
        reconciledAt: true,
      },
    }),
    prisma.otterItemMapping.findMany({
      where: { storeId: { in: storeIds } },
      select: { storeId: true, otterItemName: true, recipeId: true },
    }),
  ])

  type RevenueRow = (typeof revenueRows)[number]
  type MenuRow = (typeof menuRows)[number]

  // Latest generation per (storeId, date) for revenue. In aggregate mode we
  // then sum across stores per date.
  const latestRevenuePerStoreDate = new Map<string, RevenueRow>()
  for (const r of revenueRows) {
    const key = `${r.storeId}|${ymd(r.forecastDate as Date)}`
    const existing = latestRevenuePerStoreDate.get(key)
    if (!existing || r.generatedAt > existing.generatedAt) {
      latestRevenuePerStoreDate.set(key, r)
    }
  }
  // Sum predicted revenue / p10 / p90 per date across stores.
  const revenueByDate = new Map<
    string,
    { predictedRevenue: number; p10: number; p90: number; generatedAt: Date }
  >()
  for (const r of latestRevenuePerStoreDate.values()) {
    const k = ymd(r.forecastDate as Date)
    const cur = revenueByDate.get(k)
    const useReconciled =
      prefer === "reconciled"
      && r.reconciledRevenue != null
      && !isReconciledStale(r.reconciledAt)
    const pr = useReconciled
      ? (r.reconciledRevenue ?? 0)
      : (r.predictedRevenue ?? 0)
    const rawP10 = useReconciled ? r.reconciledP10 : r.p10
    const rawP90 = useReconciled ? r.reconciledP90 : r.p90
    const p10 = rawP10 ?? pr
    const p90 = rawP90 ?? pr
    if (!cur) {
      revenueByDate.set(k, {
        predictedRevenue: pr,
        p10,
        p90,
        generatedAt: r.generatedAt,
      })
    } else {
      cur.predictedRevenue += pr
      cur.p10 += p10
      cur.p90 += p90
      if (r.generatedAt > cur.generatedAt) cur.generatedAt = r.generatedAt
    }
  }

  // Latest generation per (storeId, sku, date) for menu items.
  const latestMenu = new Map<string, MenuRow>()
  for (const r of menuRows) {
    const key = `${r.storeId}|${r.otterItemSkuId}|${ymd(r.forecastDate as Date)}`
    const existing = latestMenu.get(key)
    if (!existing || r.generatedAt > existing.generatedAt) latestMenu.set(key, r)
  }

  // Recipe mapping is per-store: same otterItemName can map to different
  // recipes across stores.
  const recipeIdByStoreItem = new Map<string, string>()
  for (const m of mappings) {
    recipeIdByStoreItem.set(`${m.storeId}|${m.otterItemName}`, m.recipeId)
  }

  // Pre-compute every unique recipe cost in parallel — eliminates the per-day
  // sequential `await` chain that made Hollywood's render scale with menu size.
  const uniqueRecipeIds = new Set<string>()
  for (const r of latestMenu.values()) {
    const recipeId = recipeIdByStoreItem.get(`${r.storeId}|${r.otterItemSkuId}`)
    if (recipeId) uniqueRecipeIds.add(recipeId)
  }
  const recipeCostCache = new Map<string, { totalCost: number; partial: boolean }>()
  if (!input.storeId) {
    const batchedCosts = await batchRecipeCosts(user.accountId)
    for (const recipeId of uniqueRecipeIds) {
      recipeCostCache.set(
        recipeId,
        batchedCosts.get(recipeId) ?? { totalCost: 0, partial: true },
      )
    }
  } else {
    await Promise.all(
      Array.from(uniqueRecipeIds).map(async (recipeId) => {
        try {
          const r = await computeRecipeCost(recipeId, asOf, { storeId: storeIds[0] })
          recipeCostCache.set(recipeId, { totalCost: r.totalCost, partial: r.partial })
        } catch {
          recipeCostCache.set(recipeId, { totalCost: 0, partial: true })
        }
      }),
    )
  }

  // Bucket menu rows by date (across stores).
  const menuByDate = new Map<string, MenuRow[]>()
  for (const r of latestMenu.values()) {
    const key = ymd(r.forecastDate as Date)
    const list = menuByDate.get(key) ?? []
    list.push(r)
    menuByDate.set(key, list)
  }

  // Accumulate per-day rollups. Use the union of revenue + menu dates so we
  // surface a row even when one side has data and the other doesn't.
  const allDates = new Set<string>([...revenueByDate.keys(), ...menuByDate.keys()])
  const sortedDates = Array.from(allDates).sort()

  const days: FoodCostForecastDay[] = []
  let latestGen: Date | null = null
  let totalRevenue = 0
  let totalFoodCost = 0

  for (const dateKey of sortedDates) {
    const revenueRow = revenueByDate.get(dateKey) ?? null
    const items = menuByDate.get(dateKey) ?? []

    let foodCost = 0
    let foodCostP10 = 0
    let foodCostP90 = 0
    let unmappedItemCount = 0
    let partialRecipeCost = false

    for (const item of items) {
      const recipeId = recipeIdByStoreItem.get(`${item.storeId}|${item.otterItemSkuId}`)
      if (!recipeId) {
        unmappedItemCount += 1
        continue
      }
      const recipeCost = recipeCostCache.get(recipeId) ?? { totalCost: 0, partial: true }
      if (recipeCost.partial) partialRecipeCost = true
      // W6-8: prefer reconciledQty when opted in AND fresh.
      const useReconciled =
        prefer === "reconciled"
        && item.reconciledQty != null
        && !isReconciledStale(item.reconciledAt)
      const qty = useReconciled ? item.reconciledQty! : item.predictedQty
      foodCost += qty * recipeCost.totalCost
      foodCostP10 += (item.p10 ?? qty) * recipeCost.totalCost
      foodCostP90 += (item.p90 ?? qty) * recipeCost.totalCost
    }

    if (revenueRow && (!latestGen || revenueRow.generatedAt > latestGen)) {
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
      storeId: storeIdOut,
      storeName,
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
