// Server-only, not a server action: nothing in the browser calls these, so
// they are plain functions and cannot be invoked from outside the server.
// Browser saves go through `src/lib/counter/actions/`.
import "server-only"
import { getSession } from "@/lib/auth-scope"
import { cache } from "react"
import { revalidatePath } from "next/cache"
import { hasOwnerAccess } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { FOOD_COST_ROWS } from "@/lib/counter/food-cost-scope"
import { getAccountStoreRows } from "@/lib/account-stores"
import {
  buildPeriods,
  bucketSummariesByPeriod,
  computeStorePnL,
  consolidateRows,
  channelMix,
  monthlyFromFrequency,
  CUSTOM_FIXED_CODE_PREFIX,
  summarySlices,
  rowSales,
  salesRowValues,
  type CustomFixedExpense,
  type Granularity,
  type Period,
} from "@/lib/pnl"
import type { UnmappedMenuItem } from "@/types/cogs"
import { recomputeDailyCogsForRange } from "@/lib/cogs-materializer"
import { CogsStatus } from "@/generated/prisma/client"
import { cached, monthTags, stableKey } from "@/lib/cache/cached"
import { batchedDayRows, dayStart, utcDay } from "@/lib/counter/day-batch"
import { rangeScopedTags } from "@/lib/cache/closed-range"
import {
  loadLaborCost,
  laborByPeriods,
  hasFixedLabor,
  soldDaysWithoutLabor,
} from "@/lib/counter/labor-cost"
import {
  addCommission,
  bucketCommission,
  COMMISSION_LINES,
  loadOrderFeeGroups,
  type OrderFeeGroup,
  type StoreCommissionRates,
} from "@/lib/counter/commission"
import type {
  AllStoresPnLResult,
  PnLPeriodLines,
} from "./pnl-types"

/**
 * `combined`-shaped lines, one entry PER PERIOD, over whichever stores are
 * handed in.
 *
 * Built by INDEXING the same per-period arrays the range totals sum —
 * deliberately NOT re-derived from `consolidatedRows`, which would mean
 * mapping GL row codes back onto these fields and getting one wrong silently.
 * So a period here and the same period asked for on its own are the same
 * arithmetic on the same rows.
 *
 * It takes a LIST of computeds rather than closing over every store, and that
 * is the whole point of it being a function. Passing one store's computed
 * gives that store's periods by the identical route, which is what a
 * single-store trailing-weeks table needs. `loadWeekStatements` read the
 * account-wide `perPeriod` whatever store was selected, so selecting Glendale
 * on `/dashboard/pnl` printed a correct Glendale cascade above an eight-week
 * table holding all three stores — roughly triple, with nothing to say it was
 * a different scope. The rollup published no per-store answer to read instead;
 * now it does.
 */
function periodLines(
  computeds: Array<ReturnType<typeof computeStorePnL>>,
  periods: Period[],
  /**
   * Per computed, per period: the gaps behind the figures — what
   * `PnLPeriodLines` documents as `laborMissingDays`, `laborEstimatedDays`,
   * `cogsMissingDays` and `uncostedSales`. Absent reads as 0.
   */
  gaps: Partial<Record<PeriodGap, number[][]>> = {},
): PnLPeriodLines[] {
  const total = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
  return periods.map((_p, i) => {
    const at = (pick: (c: ReturnType<typeof computeStorePnL>) => number[]) =>
      total(computeds.map((c) => pick(c)[i] ?? 0))
    const gross = at((c) => c.totalSales)
    const commission = addCommission(
      computeds.flatMap((c) => (c.commission[i] ? COMMISSION_LINES.map((l) => c.commission[i][l]) : [])),
    )
    const cogs = at((c) => c.cogsValues)
    const labor = at((c) => c.laborValues)
    const rent = at((c) => c.rentValues)
    const fixed =
      labor +
      rent +
      at((c) => c.towelsValues) +
      at((c) => c.cleaningValues) +
      total(computeds.map((c) => total(c.customFixedValues.map((row) => row[i] ?? 0))))
    const bottom = at((c) => c.bottomLine)
    // `<= 0`, not `=== 0`. A window that took in less than nothing — heavy
    // refunds — has a negative denominator, and dividing by it inverts every
    // ratio's sign: a cost reads as a credit, a loss reads as a margin. Zero
    // sales and negative sales say the same thing here: there is no revenue
    // for these to be a percentage of. `prime-cost.ts`, `statement.ts` and
    // `cogs.ts` all guard with `<= 0` already; this layer was the survivor.
    const r = (v: number) => (gross <= 0 ? 0 : v / gross)
    return {
      grossSales: gross,
      salesBeforeDiscounts: at((c) => c.grossBeforeDiscounts),
      discounts: at((c) => c.discounts),
      refunds: at((c) => c.refunds),
      taxCollected: at((c) => c.taxCollected),
      commission,
      netAfterCommissions: at((c) => c.netAfterCommissions),
      fixedCosts: fixed,
      bottomLine: bottom,
      marginPct: gross <= 0 ? 0 : bottom / gross,
      cogsValue: cogs,
      cogsPct: r(cogs),
      laborValue: labor,
      laborPct: r(labor),
      rentValue: rent,
      rentPct: r(rent),
      laborMissingDays: gapAt(gaps.laborMissingDays, i),
      laborEstimatedDays: gapAt(gaps.laborEstimatedDays, i),
      cogsMissingDays: gapAt(gaps.cogsMissingDays, i),
      uncostedSales: gapAt(gaps.uncostedSales, i),
    }
  })
}

/** The per-period gap counts `periodLines` carries alongside the dollars. */
type PeriodGap = "laborMissingDays" | "laborEstimatedDays" | "cogsMissingDays" | "uncostedSales"

function gapAt(perComputed: number[][] | undefined, i: number): number {
  return (perComputed ?? []).reduce((a, m) => a + (m[i] ?? 0), 0)
}

/** The sales cascade and commission over a whole range, summed from its periods. */
function rangeSalesLines(per: PnLPeriodLines[]): Pick<
  PnLPeriodLines,
  "salesBeforeDiscounts" | "discounts" | "refunds" | "taxCollected" | "commission"
> {
  const total = (pick: (p: PnLPeriodLines) => number) => per.reduce((a, p) => a + pick(p), 0)
  return {
    salesBeforeDiscounts: total((p) => p.salesBeforeDiscounts),
    discounts: total((p) => p.discounts),
    refunds: total((p) => p.refunds),
    taxCollected: total((p) => p.taxCollected),
    commission: addCommission(per.map((p) => p.commission)),
  }
}

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
  /** COGSED but some recipe lines had no price: `lineCost` reads low. */
  partialCost?: boolean
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
  /**
   * Per period, the sales on rows whose food cost is NOT fully in
   * `cogsValues`: UNMAPPED (no recipe, $0 counted) and MISSING_COST or partly costed
   * rows (only the priced ingredients counted). The food line reads low by the cost of these.
   */
  uncostedSales: number[]
  /** `YYYY-MM-DD` days with at least one row in range. */
  daysWithRows: Set<string>
} {
  const cogsValues = periods.map(() => 0)
  const rowCountPerPeriod = periods.map(() => 0)
  const uncostedSales = periods.map(() => 0)
  const daysWithRows = new Set<string>()
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
    daysWithRows.add(new Date(row.date).toISOString().slice(0, 10))

    if (row.status === CogsStatus.UNMAPPED) {
      aggInto(unmappedAgg, row)
      uncostedSales[idx] += row.salesRevenue
      continue
    }

    cogsValues[idx] += row.lineCost

    if (row.status === CogsStatus.MISSING_COST) {
      aggInto(missingCostAgg, row)
      uncostedSales[idx] += row.salesRevenue
    } else if (row.partialCost) {
      // COSTED with some recipe lines unpriced: the total is an understatement.
      uncostedSales[idx] += row.salesRevenue
    }
  }

  const unmappedItems = Array.from(unmappedAgg.values()).sort(
    (a, b) => b.salesRevenue - a.salesRevenue
  )
  const missingCostItems = Array.from(missingCostAgg.values()).sort(
    (a, b) => b.salesRevenue - a.salesRevenue
  )
  return { cogsValues, unmappedItems, missingCostItems, rowCountPerPeriod, uncostedSales, daysWithRows }
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

/**
 * The two row reads every statement starts from, as functions of the stores
 * and bounds only, so `getAllStoresPnL` and the lean readers below read the
 * same rows the same way (and, inside one render, share one read through
 * `batchedDayRows` — same `group`, same `select`).
 *
 * Both filter by `store: { accountId }` as well as `storeId in`: the ids come
 * from the account's own store list, and the join makes the tenancy boundary
 * explicit in the query instead of in the caller.
 *
 * A range that does not start at UTC midnight reads on its own, because only
 * whole days can be cut from a shared read. See @/lib/counter/day-batch.
 */
function loadSummaryRows(accountId: string, storeIds: string[], start: Date, end: Date) {
  const read = (r: { gte: Date; lte: Date }) =>
    prisma.otterDailySummary.findMany({
      where: { storeId: { in: storeIds }, store: { accountId }, date: r },
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
        tpRefundsAdjustments: true,
        tpOrderCount: true,
      },
    })
  if (start.getTime() !== dayStart(utcDay(start)).getTime()) return read({ gte: start, lte: end })
  return batchedDayRows({
    group: `pnl-summaries|${[...storeIds].sort().join(",")}`,
    range: { first: utcDay(start), last: utcDay(end) },
    load: (r) => read({ gte: dayStart(r.first), lte: dayStart(r.last) }),
    dayOf: (row) => utcDay(row.date),
  })
}

function loadCogsRows(accountId: string, storeIds: string[], start: Date, end: Date) {
  const read = (r: { gte: Date; lte: Date }) =>
    prisma.dailyCogsItem.findMany({
      where: { storeId: { in: storeIds }, store: { accountId }, date: r, ...FOOD_COST_ROWS },
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
        partialCost: true,
      },
    })
  if (start.getTime() !== dayStart(utcDay(start)).getTime()) return read({ gte: start, lte: end })
  return batchedDayRows({
    group: `pnl-cogs|${[...storeIds].sort().join(",")}`,
    range: { first: utcDay(start), last: utcDay(end) },
    load: (r) => read({ gte: dayStart(r.first), lte: dayStart(r.last) }),
    dayOf: (row) => utcDay(row.date),
  })
}

/**
 * Net Sales per period, and nothing else.
 *
 * Several pages need only the statement's Net Sales row by day (SPLH, the
 * Decisions strip, the Labor trend) and built the whole statement for it:
 * summaries, order-fee groups, food cost, fixed expenses and labor, five reads
 * and the full cascade. Net Sales depends on the daily summaries alone, so
 * this reads those and runs the SAME arithmetic `computeStorePnL` runs for
 * that row (`salesRowValues`, summed per period), in the same order, and the
 * all-stores line is summed over stores in the same order `consolidateRows`
 * sums it. The figures are therefore the statement's own, not a second
 * derivation.
 *
 * Same refusals as `getAllStoresPnL`: no session, or a non-owner, is an
 * `error`. A failed read throws instead of degrading to an empty result.
 */
export async function getNetSalesByPeriod(input: {
  startDate: Date
  endDate: Date
  granularity: Granularity
}): Promise<
  | { error: string }
  | {
      periods: Period[]
      /** Net Sales per period summed over every store — the consolidated TOTAL_SALES row. */
      combined: number[]
      perStore: Array<{ storeId: string; net: number[] }>
    }
> {
  const session = await getSession()
  if (!session?.user) return { error: "Unauthorized" }
  if (!hasOwnerAccess(session.user.role)) return { error: "P&L is restricted to owners" }
  const accountId = session.user.accountId

  const stores = await pnlStoresCached(accountId)
  const periods = buildPeriods(input.startDate, input.endDate, input.granularity)
  if (stores.length === 0 || periods.length === 0) return { periods, combined: [], perStore: [] }

  const storeIds = stores.map((s) => s.id)
  const summaries = await loadSummaryRows(
    accountId,
    storeIds,
    periods[0].startDate,
    periods[periods.length - 1].endDate,
  )
  const byStore = new Map<string, typeof summaries>()
  for (const s of summaries) {
    const arr = byStore.get(s.storeId) ?? []
    arr.push(s)
    byStore.set(s.storeId, arr)
  }
  const perStore = stores.map((store) => ({
    storeId: store.id,
    net: bucketSummariesByPeriod(byStore.get(store.id) ?? [], periods).map((rows) =>
      salesRowValues(rows).reduce((a, b) => a + b, 0),
    ),
  }))
  const combined = periods.map((_, pi) => perStore.reduce((acc, st) => acc + (st.net[pi] ?? 0), 0))
  return { periods, combined, perStore }
}

/**
 * Net Sales and food cost over a range, for a caller that prints those two
 * figures and nothing else (menu profit). Same rows and same arithmetic as the
 * statement's `grossSales` (the sum of each store's Net Sales per period, then
 * over stores) and its COGS row (each store's `-cogsValues`, summed over
 * stores per period): `cogsRow` is that row, so the caller keeps its own
 * `-sum` and gets the number it always got. `storeId` null means every store.
 */
export async function getSalesAndCogsRow(input: {
  startDate: Date
  endDate: Date
  storeId: string | null
}): Promise<{ error: string } | { totalSales: number; cogsRow: number[] }> {
  const session = await getSession()
  if (!session?.user) return { error: "Unauthorized" }
  if (!hasOwnerAccess(session.user.role)) return { error: "P&L is restricted to owners" }
  const accountId = session.user.accountId

  const all = await pnlStoresCached(accountId)
  const stores = input.storeId === null ? all : all.filter((s) => s.id === input.storeId)
  const periods = buildPeriods(input.startDate, input.endDate, "daily")
  if (stores.length === 0 || periods.length === 0) return { totalSales: 0, cogsRow: [] }

  const storeIds = stores.map((s) => s.id)
  const start = periods[0].startDate
  const end = periods[periods.length - 1].endDate
  const [summaries, cogsRows] = await Promise.all([
    loadSummaryRows(accountId, storeIds, start, end),
    loadCogsRows(accountId, storeIds, start, end),
  ])
  const sumsBy = <R extends { storeId: string }>(rows: R[]) => {
    const m = new Map<string, R[]>()
    for (const r of rows) {
      const arr = m.get(r.storeId)
      if (arr) arr.push(r)
      else m.set(r.storeId, [r])
    }
    return m
  }
  const sumsByStore = sumsBy(summaries)
  const cogsByStore = sumsBy(cogsRows)
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

  const perStore = stores.map((store) => {
    const net = bucketSummariesByPeriod(sumsByStore.get(store.id) ?? [], periods).map((rows) =>
      salesRowValues(rows).reduce((a, b) => a + b, 0),
    )
    const cogs = summarizeDailyCogs(cogsByStore.get(store.id) ?? [], periods).cogsValues
    return { gross: sum(net), cogsRow: cogs.map((v) => -v) }
  })
  return {
    totalSales: sum(perStore.map((p) => p.gross)),
    // One store's statement reads its own row as it is; the consolidated row
    // adds the stores up from zero (which turns a -0 into 0).
    cogsRow:
      input.storeId !== null
        ? perStore[0].cogsRow
        : periods.map((_, pi) => perStore.reduce((acc, p) => acc + (p.cogsRow[pi] ?? 0), 0)),
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
  const session = await getSession()
  if (!session?.user) return { error: "Unauthorized" }
  if (!hasOwnerAccess(session.user.role)) return { error: "P&L is restricted to owners" }
  const accountId = session.user.accountId

  const result = await cached(
    // `pnl5:` since 2026-11-03 (each period carries `laborMissingDays`; skips `pnl4:`,
    // which the payroll-tax change took the same day). `pnl3:` since
    // 2026-10-28 (`pnl2:` before it grew the sales cascade; pnl3 moved labor
    // dollars to `loadLaborCost`): the answer's shape grew the sales cascade and
    // the commission basis, and a pre-change entry would lack both. `pnl4:`
    // since 2026-11-03: labor carries the employer payroll tax and its note.
    // `pnl5:` since 2026-11-04: periods carry laborMissingDays.
    // `pnl7:` since 2026-11-19 (partly costed rows count as uncosted): periods carry laborEstimatedDays,
    // cogsMissingDays and uncostedSales.
    `pnl7:account:${accountId}:${stableKey({
      s: input.startDate.toISOString(),
      e: input.endDate.toISOString(),
      g: input.granularity,
      // Custom periods (Monday weeks from `loadWeekStatements`) bucket the same
      // span differently from plain `weekly`, so they must not share an entry.
      p: input.periods?.map((p) => `${p.startDate.toISOString()}/${p.endDate.toISOString()}`).join(",") ?? null,
    })}`,
    600,
    // "pnl" stays: writers that cannot say which dates they touched
    // (`/api/otter/sync`, a fixed-expense edit — fixed costs are prorated into
    // EVERY range, so that one is right to be broad) still bust it, and a key
    // must remain reachable by them. The month tags are what let the hourly
    // sync stop evicting a statement from six weeks ago that it never wrote.
    // See `monthTags` in @/lib/cache/cached.
    // A range that ended before today is saved for hours instead, cleared only
    // by a write to one of its own days or an undated figure write (a fixed
    // expense, a store rate); see @/lib/cache/closed-range.
    rangeScopedTags(input.startDate, input.endDate, [
      "pnl",
      `account:${accountId}`,
      ...monthTags(input.startDate, input.endDate),
    ]),
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
          ...rangeSalesLines([]),
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

    // The five loads below are independent of each other: each needs only the
    // store list and the overall bounds. They were awaited one after another,
    // which put five database round trips in a row on every rollup miss; this
    // rollup is the base of Overview, P&L, Analytics, Labor, COGS and Decisions.
    // The rows below are read through `batchedDayRows`: when one render asks
    // this rollup for several ranges (Overview asks for four), overlapping
    // ranges share one read cut back to each range's days, which is the same
    // rows each range's own read returns. A range that does not start at UTC
    // midnight reads on its own, as before, because only whole days can be
    // cut from a shared read. See @/lib/counter/day-batch.
    const wholeDays = overallStart.getTime() === dayStart(utcDay(overallStart)).getTime()
    const days = { first: utcDay(overallStart), last: utcDay(overallEnd) }
    const storeKey = [...storeIds].sort().join(",")

    // ONE grouped OtterOrder read for every store's commission — see
    // `@/lib/counter/commission`. Cached on its own key, and inside this
    // rollup's cache too.
    const readFees = (startDate: Date, endDate: Date) =>
      loadOrderFeeGroups({ accountId, storeIds, startDate, endDate })

    const [allSummaries, allFeeGroups, allCogsRows, allFixedExpenses, laborCost] = await Promise.all([
      loadSummaryRows(accountId, storeIds, overallStart, overallEnd),
      wholeDays
        ? batchedDayRows({
            group: `pnl-fees|${accountId}|${storeKey}`,
            range: days,
            load: (r) => readFees(dayStart(r.first), dayStart(r.last)),
            dayOf: (g) => g.day,
          })
        : readFees(overallStart, overallEnd),
      loadCogsRows(accountId, storeIds, overallStart, overallEnd),
      pnlFixedExpensesCached(storeIds.join(",")),
      // Labor dollars, batched across stores through the same `loadLaborCost`
      // rule `getStorePnL` uses, so the all-stores roll-up and a store's own P&L
      // cannot price a week differently. Its reads are shared the same way
      // inside `loadLaborCost`.
      loadLaborCost({
        accountId: session.user.accountId,
        storeIds,
        startDate: overallStart,
        endDate: overallEnd,
      }),
    ])
    const feeGroupsByStore = new Map<string, OrderFeeGroup[]>()
    for (const g of allFeeGroups) {
      const arr = feeGroupsByStore.get(g.storeId) ?? []
      arr.push(g)
      feeGroupsByStore.set(g.storeId, arr)
    }
    const ratesByStore = new Map<string, StoreCommissionRates>(stores.map((s) => [s.id, s]))

    const byStore = new Map<string, typeof allSummaries>()
    for (const s of allSummaries) {
      const arr = byStore.get(s.storeId) ?? []
      arr.push(s)
      byStore.set(s.storeId, arr)
    }

    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

    const cogsByStore = new Map<string, DailyCogsRow[]>()
    for (const r of allCogsRows) {
      const arr = cogsByStore.get(r.storeId) ?? []
      arr.push(r)
      cogsByStore.set(r.storeId, arr)
    }

    const expensesByStore = new Map<string, FixedExpenseRow[]>()
    for (const e of allFixedExpenses) {
      const arr = expensesByStore.get(e.storeId) ?? []
      arr.push(e)
      expensesByStore.set(e.storeId, arr)
    }


    const perStoreComputed: Array<ReturnType<typeof computeStorePnL>> = []
    const perStoreGaps: Record<PeriodGap, number[][]> = {
      laborMissingDays: [],
      laborEstimatedDays: [],
      cogsMissingDays: [],
      uncostedSales: [],
    }

    const perStore = stores.map((store) => {
      const storeSummaries = byStore.get(store.id) ?? []
      const bucketed = bucketSummariesByPeriod(storeSummaries, periods)
      const storeCogs = summarizeDailyCogs(cogsByStore.get(store.id) ?? [], periods)
      const harriLaborByPeriod = laborByPeriods(laborCost.stores[store.id], periods)
      const computed = computeStorePnL({
        bucketed,
        periods,
        store,
        cogsValues: storeCogs.cogsValues,
        harriLaborByPeriod,
        customFixedExpenses: toCustomFixedExpenses(expensesByStore.get(store.id) ?? []),
        commission: bucketCommission(
          feeGroupsByStore.get(store.id) ?? [],
          periods,
          ratesByStore,
          summarySlices(storeSummaries),
        ),
      })
      perStoreComputed.push(computed)
      // A store-day sold when its rows NET above zero: several rows per day
      // (platform, payment), so a lone refund or a +X/−X pair is not a sale.
      const netByDay = new Map<string, number>()
      for (const r of storeSummaries) {
        const day = new Date(r.date).toISOString().slice(0, 10)
        netByDay.set(day, (netByDay.get(day) ?? 0) + rowSales(r).net)
      }
      const soldDays = new Set([...netByDay].filter(([, net]) => net > 0).map(([day]) => day))
      // Sold days Harri sent nothing for. With a labor budget on file
      // `computeStorePnL` fills them from it — an ESTIMATE, counted as such;
      // without one they count as $0 — MISSING.
      const uncovered = soldDaysWithoutLabor(laborCost.stores[store.id], soldDays, periods)
      const budgetFills = hasFixedLabor(store.fixedMonthlyLabor)
      const none = periods.map(() => 0)
      const missing = budgetFills ? none : uncovered
      const laborEstimated = budgetFills ? uncovered : none
      // Sold days with no DailyCogsItem row at all: food counted as $0 on them.
      const cogsMissing = periods.map((p) => {
        const start = p.startDate.toISOString().slice(0, 10)
        const end = p.endDate.toISOString().slice(0, 10)
        let n = 0
        for (const d of soldDays) if (d >= start && d <= end && !storeCogs.daysWithRows.has(d)) n += 1
        return n
      })
      const storeGaps: Record<PeriodGap, number[][]> = {
        laborMissingDays: [missing],
        laborEstimatedDays: [laborEstimated],
        cogsMissingDays: [cogsMissing],
        uncostedSales: [storeCogs.uncostedSales],
      }
      for (const k of Object.keys(storeGaps) as PeriodGap[]) perStoreGaps[k].push(storeGaps[k][0])

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
      const marginPct = grossSales <= 0 ? 0 : bottomLine / grossSales
      const ratio = (v: number) => (grossSales <= 0 ? 0 : v / grossSales)

      const totalChannelVals = computed.perPeriodSalesValues.reduce<number[]>(
        (acc, periodVals) => {
          for (let i = 0; i < periodVals.length; i++) {
            acc[i] = (acc[i] ?? 0) + periodVals[i]
          }
          return acc
        },
        []
      )

      const storePeriods = periodLines([computed], periods, storeGaps)
      return {
        storeId: store.id,
        storeName: store.name,
        grossSales,
        ...rangeSalesLines(storePeriods),
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
        laborMissingDays: sum(missing),
        laborEstimatedDays: sum(laborEstimated),
        cogsMissingDays: sum(cogsMissing),
        uncostedSales: sum(storeCogs.uncostedSales),
        channelMix: channelMix(totalChannelVals),
        fixedCostsConfigured:
          hasFixedLabor(store.fixedMonthlyLabor) && store.fixedMonthlyRent != null,
        rows: computed.rows,
        // This store's own periods, by the same route `perPeriod` takes for
        // the account. See `periodLines`.
        perPeriod: storePeriods,
      }
    })

    const combinedGross = sum(perStore.map((p) => p.grossSales))
    const combinedCogs = sum(perStore.map((p) => p.cogsValue))
    const combinedLabor = sum(perStore.map((p) => p.laborValue))
    const combinedRent = sum(perStore.map((p) => p.rentValue))
    const perPeriod = periodLines(perStoreComputed, periods, perStoreGaps)
    const combined = {
      grossSales: combinedGross,
      ...rangeSalesLines(perPeriod),
      netAfterCommissions: sum(perStore.map((p) => p.netAfterCommissions)),
      fixedCosts: sum(perStore.map((p) => p.fixedCosts)),
      bottomLine: sum(perStore.map((p) => p.bottomLine)),
      marginPct: 0,
      cogsValue: combinedCogs,
      cogsPct: combinedGross <= 0 ? 0 : combinedCogs / combinedGross,
      laborValue: combinedLabor,
      laborPct: combinedGross <= 0 ? 0 : combinedLabor / combinedGross,
      rentValue: combinedRent,
      rentPct: combinedGross <= 0 ? 0 : combinedRent / combinedGross,
      laborMissingDays: sum(perStore.map((p) => p.laborMissingDays)),
      laborEstimatedDays: sum(perStore.map((p) => p.laborEstimatedDays)),
      cogsMissingDays: sum(perStore.map((p) => p.cogsMissingDays)),
      uncostedSales: sum(perStore.map((p) => p.uncostedSales)),
    }
    combined.marginPct =
      combined.grossSales <= 0 ? 0 : combined.bottomLine / combined.grossSales

    // Merge by row code (not index): robust to stores having different custom
    // fixed expenses. Stores lacking a given code contribute 0 to that line.
    const consolidatedRows = consolidateRows(
      perStore.map((s) => s.rows),
      periods
    )

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
  return reviveAllStoresPnL(result)
}

/**
 * `periods[].startDate`/`endDate` are `Date`s on the contract and ISO strings
 * in Redis, so a cache hit handed callers strings and the first one to call a
 * Date method on them threw (SPLH's `getUTCMonth`, 2026-10-29). The two known
 * fields are revived here, explicitly — not a generic reviver; see
 * `loadVendorBasketWeeks`.
 */
function reviveAllStoresPnL(result: AllStoresPnLResult): AllStoresPnLResult {
  if ("error" in result) return result
  return {
    ...result,
    periods: result.periods.map((p) => ({
      ...p,
      startDate: new Date(p.startDate),
      endDate: new Date(p.endDate),
    })),
  }
}

export async function recomputeCogsForStore(input: {
  storeId: string
  lookbackDays?: number
}): Promise<
  | { daysProcessed: number; rowsUpserted: number; rowsDeleted: number }
  | { error: string }
> {
  try {
    const session = await getSession()
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
