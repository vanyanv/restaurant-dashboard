"use server"

import { cache } from "react"
import { revalidatePath } from "next/cache"
import { getServerSession } from "next-auth"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getAccountStoreRows } from "@/lib/account-stores"
import {
  buildPeriods,
  bucketSummariesByPeriod,
  computeStorePnL,
  consolidateRows,
  channelMix,
  monthlyFromFrequency,
  CUSTOM_FIXED_CODE_PREFIX,
  type CustomFixedExpense,
  type Granularity,
  type Period,
} from "@/lib/pnl"
import type { UnmappedMenuItem } from "@/types/cogs"
import { recomputeDailyCogsForRange } from "@/lib/cogs-materializer"
import { CogsStatus } from "@/generated/prisma/client"
import { cached, monthTags, stableKey } from "@/lib/cache/cached"
import type {
  PnLMover,
  StorePnLResult,
  AllStoresPnLResult,
} from "./pnl-types"

type FixedExpenseRow = {
  id: string
  label: string
  amount: number
  frequency: "WEEKLY" | "MONTHLY" | "YEARLY"
}

/** Map DB fixed-expense rows to the normalized CustomFixedExpense shape the
 *  pure P&L computation expects (monthly figure + `FX_<id>` row code). */
function toCustomFixedExpenses(rows: FixedExpenseRow[]): CustomFixedExpense[] {
  return rows.map((e) => ({
    code: `${CUSTOM_FIXED_CODE_PREFIX}${e.id}`,
    label: e.label,
    monthlyAmount: monthlyFromFrequency(e.amount, e.frequency),
  }))
}

const FIXED_EXPENSE_ORDER = [
  { sortOrder: "asc" as const },
  { createdAt: "asc" as const },
]

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

/**
 * Which period a row's date falls in, as a lookup rather than a scan.
 *
 * `summarizeDailyCogs` and `computeMovers` both walked `periods.findIndex(...)`
 * for EVERY row — O(rows x periods). A 90-day range across three stores with a
 * few hundred menu items is tens of thousands of `DailyCogsItem` rows, and the
 * rollup runs up to ten times per P&L render, so that comparison count is the
 * one piece of per-row work worth removing.
 *
 * Periods are contiguous and ordered, so a binary search answers exactly what
 * the linear scan did, including the two edges the scan encoded: a date before
 * the first period or after the last returns -1, and `endDate` is INCLUSIVE
 * (the scan tested `t <= p.endDate`). Same answers, same -1, fewer comparisons.
 */
function periodIndexer(periods: Period[]): (d: Date) => number {
  const starts = periods.map((p) => p.startDate.getTime())
  const ends = periods.map((p) => p.endDate.getTime())
  return (d: Date) => {
    const t = d.getTime()
    let lo = 0
    let hi = periods.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (t < starts[mid]) hi = mid - 1
      else if (t > ends[mid]) lo = mid + 1
      else return mid
    }
    return -1
  }
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

  const indexOf = periodIndexer(periods)

  for (const row of rows) {
    const idx = indexOf(row.date)
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

  const indexOf = periodIndexer(periods)

  for (const row of rows) {
    const idx = indexOf(row.date)
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

/*
 * The two reads inside `getAllStoresPnL` that DO NOT VARY BY DATE, hoisted
 * behind a per-request `cache()`.
 *
 * `/dashboard/pnl` calls the rollup ten times per render — the selected range,
 * the comparison, and eight trailing weeks (see `getPnlSectionPromises`).
 * Only three of the rollup's five queries actually depend on the range; the
 * store list and the fixed-expense list are identical across all ten and were
 * being re-fetched every time. Measured on the query log: 12 `Store` and 12
 * `StoreFixedExpense` reads for one page.
 *
 * These sit here rather than in `@/lib/account-stores` because their `select`
 * is the rollup's own — the fixed-monthly and commission columns
 * `computeStorePnL` needs — and because that module must stay session-free.
 *
 * NOT EXPORTED: this is a `"use server"` file, where every export must be an
 * async function and `cache()` returns a plain one.
 *
 * `cache()` keys on argument identity, so the fixed-expense helper takes a
 * JOINED STRING rather than the `storeIds` array — two calls with equal but
 * distinct arrays would otherwise miss each other and cache nothing.
 */
const pnlStoresCached = cache(async (accountId: string) =>
  // Whole rows from the one store query a request makes — see
  // `@/lib/account-stores`. The eight columns this used to select are all on
  // them; the `isActive` filter and the `name asc` order are unchanged.
  (await getAccountStoreRows(accountId)).filter((s) => s.isActive),
)

const pnlFixedExpensesCached = cache(async (storeIdsKey: string) =>
  prisma.storeFixedExpense.findMany({
    where: { storeId: { in: storeIdsKey === "" ? [] : storeIdsKey.split(",") }, isActive: true },
    orderBy: FIXED_EXPENSE_ORDER,
    select: { id: true, storeId: true, label: true, amount: true, frequency: true },
  }),
)

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
    const fixedExpenseRows = await prisma.storeFixedExpense.findMany({
      where: { storeId: store.id, isActive: true },
      orderBy: FIXED_EXPENSE_ORDER,
      select: { id: true, label: true, amount: true, frequency: true },
    })
    const customFixedExpenses = toCustomFixedExpenses(fixedExpenseRows)
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

    // Harri labor actuals (LiveWire). Bucket per-period; computeStorePnL
    // uses these to override the fixed-monthly labor line when coverage
    // is high, with proportional fixed-cost fallback for uncovered days.
    const harriDaily = await prisma.harriDailyLabor.findMany({
      where: {
        storeId: store.id,
        date: { gte: overallStart, lte: overallEnd },
        actualCost: { not: null },
      },
      select: { date: true, actualCost: true },
    })
    const harriLaborByPeriod = periods.map((p) => {
      let actualUsd = 0
      let coveredDays = 0
      for (const r of harriDaily) {
        if (r.date >= p.startDate && r.date <= p.endDate && r.actualCost != null) {
          actualUsd += r.actualCost
          coveredDays += 1
        }
      }
      return { actualUsd, coveredDays }
    })

    const computed = computeStorePnL({
      bucketed,
      periods,
      store,
      cogsValues: cogs.cogsValues,
      harriLaborByPeriod,
      customFixedExpenses,
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
      sum(computed.cleaningValues) +
      sum(computed.customFixedValues.flat())
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
  /**
   * Bucket boundaries, supplied rather than inferred.
   *
   * `buildPeriods` derives buckets from `granularity`, and its weekly buckets
   * start on SUNDAY. Counter's trailing-weeks table runs Monday to Sunday, so
   * a caller wanting eight Monday weeks could not ask for them — it had to
   * make eight separate rollup calls, one per week, which is where 8 of this
   * page's 10 calls came from.
   *
   * When present this is used verbatim and `granularity` is ignored for
   * bucketing. It still forms part of the cache key via the caller's own
   * bounds, so two callers asking for different bucketings of the same range
   * cannot collide.
   */
  periods?: Period[]
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
    // "pnl" stays: writers that cannot say which dates they touched
    // (`/api/otter/sync`, a fixed-expense edit — fixed costs are prorated into
    // EVERY range, so that one is right to be broad) still bust it, and a key
    // must remain reachable by them. The month tags are what let the hourly
    // sync stop evicting a statement from six weeks ago that it never wrote.
    // See `monthTags` in @/lib/cache/cached.
    ["pnl", `account:${accountId}`, ...monthTags(input.startDate, input.endDate)],
    async () => {
  try {
    const stores = await pnlStoresCached(session.user.accountId)

    const periods =
      input.periods ?? buildPeriods(input.startDate, input.endDate, input.granularity)
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
        perPeriod: [],
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

    const allFixedExpenses = await pnlFixedExpensesCached(storeIds.join(","))
    const expensesByStore = new Map<string, FixedExpenseRow[]>()
    for (const e of allFixedExpenses) {
      const arr = expensesByStore.get(e.storeId) ?? []
      arr.push(e)
      expensesByStore.set(e.storeId, arr)
    }

    // Harri labor actuals (LiveWire), batched across stores. Mirrors the
    // per-store fetch in getStorePnL so the all-stores roll-up reflects actual
    // labor instead of falling back to the (often unset) fixed-monthly estimate.
    const allHarriLabor = await prisma.harriDailyLabor.findMany({
      where: {
        storeId: { in: storeIds },
        date: { gte: overallStart, lte: overallEnd },
        actualCost: { not: null },
      },
      select: { storeId: true, date: true, actualCost: true },
    })
    const harriByStore = new Map<string, typeof allHarriLabor>()
    for (const r of allHarriLabor) {
      const arr = harriByStore.get(r.storeId) ?? []
      arr.push(r)
      harriByStore.set(r.storeId, arr)
    }

    const perStoreComputed: Array<ReturnType<typeof computeStorePnL>> = []

    const perStore = stores.map((store) => {
      const storeSummaries = byStore.get(store.id) ?? []
      const bucketed = bucketSummariesByPeriod(storeSummaries, periods)
      const storeCogs = summarizeDailyCogs(cogsByStore.get(store.id) ?? [], periods)
      const storeHarri = harriByStore.get(store.id) ?? []
      const harriLaborByPeriod = periods.map((p) => {
        let actualUsd = 0
        let coveredDays = 0
        for (const r of storeHarri) {
          if (r.date >= p.startDate && r.date <= p.endDate && r.actualCost != null) {
            actualUsd += r.actualCost
            coveredDays += 1
          }
        }
        return { actualUsd, coveredDays }
      })
      const computed = computeStorePnL({
        bucketed,
        periods,
        store,
        cogsValues: storeCogs.cogsValues,
        harriLaborByPeriod,
        customFixedExpenses: toCustomFixedExpenses(expensesByStore.get(store.id) ?? []),
      })
      perStoreComputed.push(computed)

      const grossSales = sum(computed.totalSales)
      const netAfterCommissions = sum(computed.netAfterCommissions)
      const cogsValue = sum(computed.cogsValues)
      const laborValue = sum(computed.laborValues)
      const rentValue = sum(computed.rentValues)
      const fixedCosts =
        laborValue +
        rentValue +
        sum(computed.towelsValues) +
        sum(computed.cleaningValues) +
        sum(computed.customFixedValues.flat())
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

    // Merge by row code (not index): robust to stores having different custom
    // fixed expenses. Stores lacking a given code contribute 0 to that line.
    const consolidatedRows = consolidateRows(
      perStore.map((s) => s.rows),
      periods
    )

    /*
     * `combined`, per period. Same arithmetic as the block above, indexed
     * instead of summed — deliberately NOT re-derived from `consolidatedRows`,
     * which would mean mapping GL row codes back onto these fields and getting
     * one wrong silently.
     */
    const perPeriod = periods.map((_p, i) => {
      const at = (xs: number[][]) => sum(xs.map((v) => v[i] ?? 0))
      const gross = at(perStoreComputed.map((c) => c.totalSales))
      const cogs = at(perStoreComputed.map((c) => c.cogsValues))
      const labor = at(perStoreComputed.map((c) => c.laborValues))
      const rent = at(perStoreComputed.map((c) => c.rentValues))
      const fixed =
        labor +
        rent +
        at(perStoreComputed.map((c) => c.towelsValues)) +
        at(perStoreComputed.map((c) => c.cleaningValues)) +
        sum(
          perStoreComputed.map((c) =>
            sum(c.customFixedValues.map((row) => row[i] ?? 0)),
          ),
        )
      const bottom = at(perStoreComputed.map((c) => c.bottomLine))
      const r = (v: number) => (gross === 0 ? 0 : v / gross)
      return {
        grossSales: gross,
        netAfterCommissions: at(perStoreComputed.map((c) => c.netAfterCommissions)),
        fixedCosts: fixed,
        bottomLine: bottom,
        marginPct: gross === 0 ? 0 : bottom / gross,
        cogsValue: cogs,
        cogsPct: r(cogs),
        laborValue: labor,
        laborPct: r(labor),
        rentValue: rent,
        rentPct: r(rent),
      }
    })

    return {
      storeCount: stores.length,
      combined,
      perStore,
      consolidatedRows,
      perPeriod,
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
