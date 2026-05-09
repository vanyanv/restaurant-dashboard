"use server"

import { revalidatePath } from "next/cache"
import { getServerSession } from "next-auth"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import {
  buildPeriods,
  bucketSummariesByPeriod,
  computeStorePnL,
  channelMix,
  TOTAL_SALES_CODE,
  type Granularity,
  type Period,
} from "@/lib/pnl"
import type { UnmappedMenuItem } from "@/types/cogs"
import { recomputeDailyCogsForRange } from "@/lib/cogs-materializer"
import { CogsStatus } from "@/generated/prisma/client"
import { cached, stableKey } from "@/lib/cache/cached"
import type {
  PnLMover,
  StorePnLResult,
  AllStoresPnLResult,
} from "./pnl-types"

type DailyCogsRow = {
  date: Date
  itemName: string
  category: string
  qtySold: number
  salesRevenue: number
  lineCost: number
  status: CogsStatus
  recipeId: string | null
}

function summarizeDailyCogs(rows: DailyCogsRow[], periods: Period[]): {
  cogsValues: number[]
  unmappedItems: UnmappedMenuItem[]
  missingCostItems: UnmappedMenuItem[]
  rowCountPerPeriod: number[]
} {
  const cogsValues = periods.map(() => 0)
  const rowCountPerPeriod = periods.map(() => 0)
  const unmappedAgg = new Map<string, UnmappedMenuItem>()
  const missingCostAgg = new Map<string, UnmappedMenuItem>()

  const aggInto = (
    bucket: Map<string, UnmappedMenuItem>,
    row: DailyCogsRow
  ) => {
    const key = `${row.itemName}:::${row.category}`
    const existing = bucket.get(key)
    if (existing) {
      existing.qtySold += row.qtySold
      existing.salesRevenue += row.salesRevenue
    } else {
      bucket.set(key, {
        itemName: row.itemName,
        category: row.category,
        qtySold: row.qtySold,
        salesRevenue: row.salesRevenue,
      })
    }
  }

  for (const row of rows) {
    const t = row.date.getTime()
    const idx = periods.findIndex(
      (p) => t >= p.startDate.getTime() && t <= p.endDate.getTime()
    )
    if (idx === -1) continue

    rowCountPerPeriod[idx]++

    if (row.status === CogsStatus.UNMAPPED) {
      aggInto(unmappedAgg, row)
      continue
    }

    cogsValues[idx] += row.lineCost

    if (row.status === CogsStatus.MISSING_COST) {
      aggInto(missingCostAgg, row)
    }
  }

  const unmappedItems = Array.from(unmappedAgg.values()).sort(
    (a, b) => b.salesRevenue - a.salesRevenue
  )
  const missingCostItems = Array.from(missingCostAgg.values()).sort(
    (a, b) => b.salesRevenue - a.salesRevenue
  )
  return { cogsValues, unmappedItems, missingCostItems, rowCountPerPeriod }
}

function computeMovers(
  rows: DailyCogsRow[],
  periods: Period[],
  currentIdx: number,
  priorIdx: number,
  limit = 5
): PnLMover[] {
  if (periods.length < 2 || currentIdx === priorIdx) return []

  const byItem = new Map<
    string,
    {
      itemName: string
      category: string
      currentRev: number
      priorRev: number
      currentQty: number
      priorQty: number
    }
  >()

  for (const row of rows) {
    const t = row.date.getTime()
    const idx = periods.findIndex(
      (p) => t >= p.startDate.getTime() && t <= p.endDate.getTime()
    )
    if (idx !== currentIdx && idx !== priorIdx) continue

    const key = `${row.itemName}:::${row.category}`
    let bucket = byItem.get(key)
    if (!bucket) {
      bucket = {
        itemName: row.itemName,
        category: row.category,
        currentRev: 0,
        priorRev: 0,
        currentQty: 0,
        priorQty: 0,
      }
      byItem.set(key, bucket)
    }
    if (idx === currentIdx) {
      bucket.currentRev += row.salesRevenue
      bucket.currentQty += row.qtySold
    } else {
      bucket.priorRev += row.salesRevenue
      bucket.priorQty += row.qtySold
    }
  }

  const movers: PnLMover[] = []
  for (const b of byItem.values()) {
    const delta = b.currentRev - b.priorRev
    if (Math.abs(delta) < 1) continue
    movers.push({
      itemName: b.itemName,
      category: b.category,
      current: b.currentRev,
      prior: b.priorRev,
      delta,
      pctDelta: b.priorRev === 0 ? (delta > 0 ? 1 : -1) : delta / Math.abs(b.priorRev),
      qtyCurrent: b.currentQty,
      qtyPrior: b.priorQty,
      qtyDelta: b.currentQty - b.priorQty,
    })
  }
  movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
  return movers.slice(0, limit)
}

export async function getStorePnL(input: {
  storeId: string
  startDate: Date
  endDate: Date
  granularity: Granularity
}): Promise<StorePnLResult> {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) return { error: "Unauthorized" }
    if (!hasOwnerAccess(session.user.role)) return { error: "P&L is restricted to owners" }

    const store = await prisma.store.findFirst({
      where: { id: input.storeId, accountId: session.user.accountId },
      select: {
        id: true,
        name: true,
        fixedMonthlyLabor: true,
        fixedMonthlyRent: true,
        fixedMonthlyTowels: true,
        fixedMonthlyCleaning: true,
        uberCommissionRate: true,
        doordashCommissionRate: true,
      },
    })
    if (!store) return { error: "Store not found" }

    const periods = buildPeriods(input.startDate, input.endDate, input.granularity)
    if (periods.length === 0) {
      return {
        storeName: store.name,
        periods: [],
        rows: [],
        fixedLaborConfigured: store.fixedMonthlyLabor != null,
        fixedRentConfigured: store.fixedMonthlyRent != null,
        kpis: {
          grossSales: 0,
          netAfterCommissions: 0,
          fixedCosts: 0,
          bottomLine: 0,
          marginPct: 0,
        },
        channelMix: [],
        trend: { totalSales: [], bottomLine: [] },
        cogs: {
          totalCogs: 0,
          grossProfit: 0,
          grossMarginPct: 0,
          unmappedItems: [],
          missingCostItems: [],
          refillFailedPeriodIndexes: [],
        },
        movers: [],
      }
    }

    const overallStart = periods[0].startDate
    const overallEnd = periods[periods.length - 1].endDate

    const summaries = await prisma.otterDailySummary.findMany({
      where: {
        storeId: store.id,
        date: { gte: overallStart, lte: overallEnd },
      },
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
    })

    const bucketed = bucketSummariesByPeriod(summaries, periods)
    const cogsRows = await prisma.dailyCogsItem.findMany({
      where: {
        storeId: store.id,
        date: { gte: overallStart, lte: overallEnd },
      },
      select: {
        date: true,
        itemName: true,
        category: true,
        qtySold: true,
        salesRevenue: true,
        lineCost: true,
        status: true,
        recipeId: true,
      },
    })
    const cogs = summarizeDailyCogs(cogsRows, periods)

    const computed = computeStorePnL({
      bucketed,
      periods,
      store,
      cogsValues: cogs.cogsValues,
    })

    const refillFailedPeriodIndexes: number[] = []
    for (let i = 0; i < periods.length; i++) {
      if (cogs.rowCountPerPeriod[i] === 0 && computed.totalSales[i] > 0) {
        refillFailedPeriodIndexes.push(i)
      }
    }
    if (refillFailedPeriodIndexes.length > 0) {
      console.warn("[getStorePnL] missing DailyCogsItem rows", {
        storeId: store.id,
        accountId: session.user.accountId,
        periodsMissing: refillFailedPeriodIndexes.map((i) => ({
          start: periods[i].startDate.toISOString().slice(0, 10),
          end: periods[i].endDate.toISOString().slice(0, 10),
          sales: computed.totalSales[i],
        })),
      })
    }
    const movers = periods.length >= 2
      ? computeMovers(cogsRows, periods, periods.length - 1, periods.length - 2, 5)
      : []

    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
    const grossSales = sum(computed.totalSales)
    const netAfterCommissions = sum(computed.netAfterCommissions)
    const totalCogs = sum(computed.cogsValues)
    const grossProfit = sum(computed.grossProfit)
    const grossMarginPct = grossSales === 0 ? 0 : grossProfit / grossSales
    const fixedCosts =
      sum(computed.laborValues) +
      sum(computed.rentValues) +
      sum(computed.towelsValues) +
      sum(computed.cleaningValues)
    const bottomLine = sum(computed.bottomLine)
    const marginPct = grossSales === 0 ? 0 : bottomLine / grossSales

    const totalChannelVals = computed.perPeriodSalesValues.reduce<number[]>(
      (acc, periodVals) => {
        for (let i = 0; i < periodVals.length; i++) {
          acc[i] = (acc[i] ?? 0) + periodVals[i]
        }
        return acc
      },
      []
    )

    return {
      storeName: store.name,
      periods,
      rows: computed.rows,
      fixedLaborConfigured: store.fixedMonthlyLabor != null,
      fixedRentConfigured: store.fixedMonthlyRent != null,
      kpis: {
        grossSales,
        netAfterCommissions,
        fixedCosts,
        bottomLine,
        marginPct,
      },
      channelMix: channelMix(totalChannelVals),
      trend: {
        totalSales: computed.totalSales,
        bottomLine: computed.bottomLine,
      },
      cogs: {
        totalCogs,
        grossProfit,
        grossMarginPct,
        unmappedItems: cogs.unmappedItems,
        missingCostItems: cogs.missingCostItems,
        refillFailedPeriodIndexes,
      },
      movers,
    }
  } catch (error) {
    console.error("getStorePnL error:", error)
    const msg = error instanceof Error ? error.message : String(error)
    return { error: `Failed to load P&L: ${msg.slice(0, 300)}` }
  }
}

export async function getAllStoresPnL(input: {
  startDate: Date
  endDate: Date
  granularity: Granularity
}): Promise<AllStoresPnLResult> {
  const session = await getServerSession(authOptions)
  if (!session?.user) return { error: "Unauthorized" }
  if (!hasOwnerAccess(session.user.role)) return { error: "P&L is restricted to owners" }
  const accountId = session.user.accountId

  return cached(
    `pnl:account:${accountId}:${stableKey({
      s: input.startDate.toISOString(),
      e: input.endDate.toISOString(),
      g: input.granularity,
    })}`,
    600,
    ["pnl", `account:${accountId}`],
    async () => {
  try {
    const stores = await prisma.store.findMany({
      where: { accountId: session.user.accountId, isActive: true },
      select: {
        id: true,
        name: true,
        fixedMonthlyLabor: true,
        fixedMonthlyRent: true,
        fixedMonthlyTowels: true,
        fixedMonthlyCleaning: true,
        uberCommissionRate: true,
        doordashCommissionRate: true,
      },
      orderBy: { name: "asc" },
    })

    const periods = buildPeriods(input.startDate, input.endDate, input.granularity)
    if (stores.length === 0 || periods.length === 0) {
      return {
        storeCount: 0,
        combined: {
          grossSales: 0,
          netAfterCommissions: 0,
          fixedCosts: 0,
          bottomLine: 0,
          marginPct: 0,
          cogsValue: 0,
          cogsPct: 0,
          laborValue: 0,
          laborPct: 0,
          rentValue: 0,
          rentPct: 0,
        },
        perStore: [],
        consolidatedRows: [],
        periods,
      }
    }

    const storeIds = stores.map((s) => s.id)
    const overallStart = periods[0].startDate
    const overallEnd = periods[periods.length - 1].endDate

    const allSummaries = await prisma.otterDailySummary.findMany({
      where: {
        storeId: { in: storeIds },
        date: { gte: overallStart, lte: overallEnd },
      },
      select: {
        storeId: true,
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
    })

    const byStore = new Map<string, typeof allSummaries>()
    for (const s of allSummaries) {
      const arr = byStore.get(s.storeId) ?? []
      arr.push(s)
      byStore.set(s.storeId, arr)
    }

    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

    const allCogsRows = await prisma.dailyCogsItem.findMany({
      where: {
        storeId: { in: storeIds },
        date: { gte: overallStart, lte: overallEnd },
      },
      select: {
        storeId: true,
        date: true,
        itemName: true,
        category: true,
        qtySold: true,
        salesRevenue: true,
        lineCost: true,
        status: true,
        recipeId: true,
      },
    })
    const cogsByStore = new Map<string, DailyCogsRow[]>()
    for (const r of allCogsRows) {
      const arr = cogsByStore.get(r.storeId) ?? []
      arr.push(r)
      cogsByStore.set(r.storeId, arr)
    }

    const perStore = stores.map((store) => {
      const storeSummaries = byStore.get(store.id) ?? []
      const bucketed = bucketSummariesByPeriod(storeSummaries, periods)
      const storeCogs = summarizeDailyCogs(cogsByStore.get(store.id) ?? [], periods)
      const computed = computeStorePnL({
        bucketed,
        periods,
        store,
        cogsValues: storeCogs.cogsValues,
      })

      const grossSales = sum(computed.totalSales)
      const netAfterCommissions = sum(computed.netAfterCommissions)
      const cogsValue = sum(computed.cogsValues)
      const laborValue = sum(computed.laborValues)
      const rentValue = sum(computed.rentValues)
      const fixedCosts =
        laborValue +
        rentValue +
        sum(computed.towelsValues) +
        sum(computed.cleaningValues)
      const bottomLine = sum(computed.bottomLine)
      const marginPct = grossSales === 0 ? 0 : bottomLine / grossSales
      const ratio = (v: number) => (grossSales === 0 ? 0 : v / grossSales)

      const totalChannelVals = computed.perPeriodSalesValues.reduce<number[]>(
        (acc, periodVals) => {
          for (let i = 0; i < periodVals.length; i++) {
            acc[i] = (acc[i] ?? 0) + periodVals[i]
          }
          return acc
        },
        []
      )

      return {
        storeId: store.id,
        storeName: store.name,
        grossSales,
        netAfterCommissions,
        fixedCosts,
        bottomLine,
        marginPct,
        cogsValue,
        cogsPct: ratio(cogsValue),
        laborValue,
        laborPct: ratio(laborValue),
        rentValue,
        rentPct: ratio(rentValue),
        channelMix: channelMix(totalChannelVals),
        fixedCostsConfigured:
          store.fixedMonthlyLabor != null && store.fixedMonthlyRent != null,
        rows: computed.rows,
      }
    })

    const combinedGross = sum(perStore.map((p) => p.grossSales))
    const combinedCogs = sum(perStore.map((p) => p.cogsValue))
    const combinedLabor = sum(perStore.map((p) => p.laborValue))
    const combinedRent = sum(perStore.map((p) => p.rentValue))
    const combined = {
      grossSales: combinedGross,
      netAfterCommissions: sum(perStore.map((p) => p.netAfterCommissions)),
      fixedCosts: sum(perStore.map((p) => p.fixedCosts)),
      bottomLine: sum(perStore.map((p) => p.bottomLine)),
      marginPct: 0,
      cogsValue: combinedCogs,
      cogsPct: combinedGross === 0 ? 0 : combinedCogs / combinedGross,
      laborValue: combinedLabor,
      laborPct: combinedGross === 0 ? 0 : combinedLabor / combinedGross,
      rentValue: combinedRent,
      rentPct: combinedGross === 0 ? 0 : combinedRent / combinedGross,
    }
    combined.marginPct =
      combined.grossSales === 0 ? 0 : combined.bottomLine / combined.grossSales

    const consolidatedRows = []
    const firstStoreRows = perStore[0]?.rows ?? []
    for (let rowIdx = 0; rowIdx < firstStoreRows.length; rowIdx++) {
      const template = firstStoreRows[rowIdx]
      const combinedValues = periods.map((_, pi) =>
        perStore.reduce((acc, s) => acc + (s.rows[rowIdx]?.values[pi] ?? 0), 0)
      )
      const combinedGrossPerPeriod = periods.map((_, pi) =>
        perStore.reduce(
          (acc, s) =>
            acc + (s.rows.find((r) => r.code === TOTAL_SALES_CODE)?.values[pi] ?? 0),
          0
        )
      )
      const combinedUnknown = periods.map((_, pi) =>
        perStore.every((s) => s.rows[rowIdx]?.isUnknown?.[pi] === true)
      )
      const anyUnknown = combinedUnknown.some(Boolean)
      consolidatedRows.push({
        code: template.code,
        label: template.label,
        values: combinedValues,
        percents: combinedValues.map((v, i) =>
          combinedGrossPerPeriod[i] === 0 ? 0 : v / combinedGrossPerPeriod[i]
        ),
        isSubtotal: template.isSubtotal,
        isFixed: template.isFixed,
        isUnknown: anyUnknown ? combinedUnknown : undefined,
      })
    }

    return {
      storeCount: stores.length,
      combined,
      perStore,
      consolidatedRows,
      periods,
    }
  } catch (error) {
    console.error("getAllStoresPnL error:", error)
    const msg = error instanceof Error ? error.message : String(error)
    return { error: `Failed to load P&L: ${msg.slice(0, 300)}` }
  }
    },
  )
}

export async function recomputeCogsForStore(input: {
  storeId: string
  lookbackDays?: number
}): Promise<
  | { daysProcessed: number; rowsUpserted: number; rowsDeleted: number }
  | { error: string }
> {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) return { error: "Unauthorized" }
    if (!hasOwnerAccess(session.user.role))
      return { error: "P&L is restricted to owners" }

    const store = await prisma.store.findFirst({
      where: { id: input.storeId, accountId: session.user.accountId },
      select: { id: true },
    })
    if (!store) return { error: "Store not found" }

    const lookbackDays = input.lookbackDays ?? 90
    const endDate = new Date()
    endDate.setUTCHours(0, 0, 0, 0)
    const startDate = new Date(endDate)
    startDate.setUTCDate(startDate.getUTCDate() - lookbackDays)

    const result = await recomputeDailyCogsForRange({
      storeId: store.id,
      startDate,
      endDate,
      accountId: session.user.accountId,
    })

    revalidatePath(`/dashboard/pnl/${store.id}`)
    revalidatePath(`/dashboard/pnl`)
    return result
  } catch (error) {
    console.error("recomputeCogsForStore error:", error)
    const msg = error instanceof Error ? error.message : String(error)
    return { error: `Failed to recompute COGS: ${msg.slice(0, 300)}` }
  }
}
