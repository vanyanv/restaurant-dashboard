import { z } from "zod"
import {
  bucketSummariesByPeriod,
  buildPeriods,
  channelMix,
  computeStorePnL,
  type Granularity,
  type OtterSummaryRow,
  type Period,
  type PnLRow,
} from "@/lib/pnl"
import { CogsStatus } from "@/generated/prisma/client"
import {
  dateRangeSchema,
  parseDateRange,
  resolveStoreIds,
  storeIdsSchema,
} from "./_shared"
import type { ChatTool, ChatToolContext } from "./types"

/**
 * P&L summary for the chat assistant.
 *
 * Returns the full P&L matrix (every GL row + subtotals + operating costs)
 * plus pre-rolled totals so the model can answer line-item questions
 * ("DoorDash sales", "discounts", "rent", "labor %") and headline questions
 * ("are we profitable?", "what's our COGS %?") from a single tool call.
 *
 * All numbers come from `computeStorePnL` — the same pure function the
 * dashboard's /pnl pages use — so chat answers track the dashboard exactly.
 *
 * Sign convention (matches `computeStorePnL`): in `rows[].values[]`, sales
 * rows are positive; commissions, COGS, labor, rent, cleaning, towels are
 * negative. The `totals` block returns positive magnitudes for cost-side
 * fields (`cogsDollars`, `laborDollars`, etc.) for prose convenience.
 */

const params = z
  .object({
    storeIds: storeIdsSchema,
    dateRange: dateRangeSchema,
    granularity: z
      .enum(["daily", "weekly", "monthly"])
      .optional()
      .describe(
        "Period bucket size. Defaults to 'daily' for windows ≤ 14 days, else 'weekly'.",
      ),
    comparePrevious: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "When true, also compute the prior-equivalent window (same span, immediately before) and return pp/dollar deltas.",
      ),
  })
  .strict()

type Params = z.infer<typeof params>

type StoreFixed = {
  id: string
  name: string
  fixedMonthlyLabor: number | null
  fixedMonthlyRent: number | null
  fixedMonthlyTowels: number | null
  fixedMonthlyCleaning: number | null
  uberCommissionRate: number
  doordashCommissionRate: number
  targetCogsPct: number | null
}

type SummaryRow = OtterSummaryRow & {
  storeId: string
  date: Date
  fpOrderCount: number | null
  tpOrderCount: number | null
}

type CogsRow = {
  storeId: string
  date: Date
  lineCost: number
  status: CogsStatus
}

export interface PnlTotals {
  grossSales: number
  netAfterCommissions: number
  cogsDollars: number
  cogsPct: number
  grossProfit: number
  grossMarginPct: number
  laborDollars: number
  laborPct: number
  rentDollars: number
  rentPct: number
  fixedCostsTotal: number
  bottomLine: number
  netMarginPct: number
  /** Sales-weighted target across stores; null when no store has a target. */
  targetCogsPct: number | null
  /** cogsPct − targetCogsPct (negative = under target = good). */
  vsTargetPp: number | null
  orderCount: number
  avgTicket: number
  cashSales: number
  cashPct: number
  cardSales: number
  cardPct: number
  /** fixedCostsTotal / (1 − cogsPct − effectiveCommissionRate). Null when denominator ≤ 0. */
  breakEvenSales: number | null
}

export interface PnlPeriodCell {
  label: string
  startDate: string
  endDate: string
  days: number
  isPartial: boolean
}

export interface PnlChannelCell {
  channel: string
  amount: number
  pctOfTotal: number
}

export interface PnlStoreBlock {
  storeId: string
  storeName: string
  rows: PnLRow[]
  totals: PnlTotals
  channelMix: PnlChannelCell[]
}

export interface PnlSummaryResult {
  scope: {
    storeCount: number
    storeNames: string[]
    dateFrom: string
    dateTo: string
    granularity: Granularity
  }
  rows: PnLRow[]
  periods: PnlPeriodCell[]
  totals: PnlTotals
  channelMix: PnlChannelCell[]
  perStore?: PnlStoreBlock[]
  previousPeriod?: {
    totals: PnlTotals
    deltas: {
      grossSalesDollars: number
      cogsPp: number
      laborPp: number
      marginPp: number
      bottomLineDollars: number
      orderCountDelta: number
      avgTicketDelta: number
    }
  }
  caveats: string[]
}

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0)

const ymd = (d: Date): string => d.toISOString().slice(0, 10)

/** Default granularity: daily for short windows, weekly for longer ones. */
function defaultGranularity(from: Date, to: Date): Granularity {
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1
  return days <= 14 ? "daily" : "weekly"
}

/** Bucket COGS rows into [period][cogsValue, anyRowCount] arrays. Only
 * COSTED rows contribute to cogsValue; all statuses count toward rowCount
 * so we can detect "refill hasn't run yet" gaps. */
function bucketCogs(rows: CogsRow[], periods: Period[]): {
  cogsValues: number[]
  rowCountPerPeriod: number[]
} {
  const cogsValues = periods.map(() => 0)
  const rowCountPerPeriod = periods.map(() => 0)
  for (const r of rows) {
    const t = r.date.getTime()
    const idx = periods.findIndex(
      (p) => t >= p.startDate.getTime() && t <= p.endDate.getTime(),
    )
    if (idx === -1) continue
    rowCountPerPeriod[idx]++
    if (r.status === CogsStatus.COSTED) cogsValues[idx] += r.lineCost
  }
  return { cogsValues, rowCountPerPeriod }
}

/** Sum (fpOrderCount + tpOrderCount) per period. */
function bucketOrderCount(rows: SummaryRow[], periods: Period[]): number[] {
  const counts = periods.map(() => 0)
  for (const r of rows) {
    const t = r.date.getTime()
    const idx = periods.findIndex(
      (p) => t >= p.startDate.getTime() && t <= p.endDate.getTime(),
    )
    if (idx === -1) continue
    counts[idx] += (r.fpOrderCount ?? 0) + (r.tpOrderCount ?? 0)
  }
  return counts
}

/** Window-level sales-weighted target across stores. Null when none has one. */
function weightedTarget(stores: StoreFixed[], salesByStore: Map<string, number>): number | null {
  let weightedNum = 0
  let weightDen = 0
  for (const s of stores) {
    if (s.targetCogsPct == null) continue
    const w = salesByStore.get(s.id) ?? 0
    if (w <= 0) continue
    weightedNum += s.targetCogsPct * w
    weightDen += w
  }
  return weightDen > 0 ? weightedNum / weightDen : null
}

/** Sum each store's `rows[]` index-wise into one combined matrix. Mirrors
 * the consolidation logic in getAllStoresPnL. */
function combineRows(perStoreRows: PnLRow[][], periodCount: number): PnLRow[] {
  if (perStoreRows.length === 0) return []
  const template = perStoreRows[0]
  const grossPerPeriod: number[] = Array.from({ length: periodCount }, (_, pi) =>
    perStoreRows.reduce((acc, rows) => {
      const total = rows.find((r) => r.code === "TOTAL_SALES")
      return acc + (total?.values[pi] ?? 0)
    }, 0),
  )
  return template.map((tmpl, rowIdx) => {
    const values = Array.from({ length: periodCount }, (_, pi) =>
      perStoreRows.reduce((acc, rows) => acc + (rows[rowIdx]?.values[pi] ?? 0), 0),
    )
    const isUnknownByPeriod = Array.from({ length: periodCount }, (_, pi) =>
      perStoreRows.every((rows) => rows[rowIdx]?.isUnknown?.[pi] === true),
    )
    const anyUnknown = isUnknownByPeriod.some(Boolean)
    return {
      code: tmpl.code,
      label: tmpl.label,
      values,
      percents: values.map((v, i) =>
        grossPerPeriod[i] === 0 ? 0 : v / grossPerPeriod[i],
      ),
      isSubtotal: tmpl.isSubtotal,
      isFixed: tmpl.isFixed,
      isUnknown: anyUnknown ? isUnknownByPeriod : undefined,
    }
  })
}

/** Pull the row by code and sum across periods. */
function rowSum(rows: PnLRow[], code: string): number {
  const r = rows.find((x) => x.code === code)
  return r ? sum(r.values) : 0
}

/** Build the totals block from a row matrix + extras. */
function buildTotals(input: {
  rows: PnLRow[]
  orderCount: number
  targetCogsPct: number | null
  fixedCostsTotal: number
}): PnlTotals {
  const { rows, orderCount, targetCogsPct, fixedCostsTotal } = input
  const grossSales = rowSum(rows, "TOTAL_SALES")
  const netAfterCommissions = rowSum(rows, "NET_COM")
  const cogsRowSum = rowSum(rows, "6100") // negative
  const grossProfit = rowSum(rows, "GROSS_PROFIT")
  const bottomLine = rowSum(rows, "AFTER_FIXED")
  const laborSum = rowSum(rows, "6200") // negative
  const rentSum = rowSum(rows, "7200")   // negative
  const uberComm = rowSum(rows, "COM_UBER")    // negative
  const doordashComm = rowSum(rows, "COM_DD")  // negative
  const cardSales = rowSum(rows, "4010")
  const cashSales = rowSum(rows, "4011")

  const cogsDollars = -cogsRowSum
  const laborDollars = -laborSum
  const rentDollars = -rentSum

  const cogsPct = grossSales > 0 ? cogsDollars / grossSales : 0
  const grossMarginPct = grossSales > 0 ? grossProfit / grossSales : 0
  const laborPct = grossSales > 0 ? laborDollars / grossSales : 0
  const rentPct = grossSales > 0 ? rentDollars / grossSales : 0
  const netMarginPct = grossSales > 0 ? bottomLine / grossSales : 0
  const cashPct = grossSales > 0 ? cashSales / grossSales : 0
  const cardPct = grossSales > 0 ? cardSales / grossSales : 0
  const vsTargetPp = targetCogsPct != null ? cogsPct - targetCogsPct : null

  const effectiveCommissionRate =
    grossSales > 0 ? (Math.abs(uberComm) + Math.abs(doordashComm)) / grossSales : 0
  const denom = 1 - cogsPct - effectiveCommissionRate
  const breakEvenSales = denom > 0 ? fixedCostsTotal / denom : null

  const avgTicket = orderCount > 0 ? grossSales / orderCount : 0

  return {
    grossSales,
    netAfterCommissions,
    cogsDollars,
    cogsPct,
    grossProfit,
    grossMarginPct,
    laborDollars,
    laborPct,
    rentDollars,
    rentPct,
    fixedCostsTotal,
    bottomLine,
    netMarginPct,
    targetCogsPct,
    vsTargetPp,
    orderCount,
    avgTicket,
    cashSales,
    cashPct,
    cardSales,
    cardPct,
    breakEvenSales,
  }
}

interface WindowComputation {
  rows: PnLRow[]
  totals: PnlTotals
  perStore: PnlStoreBlock[]
  channelMix: PnlChannelCell[]
  caveats: string[]
}

/** Run the full P&L computation for a single window across the given stores. */
async function computeWindow(input: {
  ctx: ChatToolContext
  stores: StoreFixed[]
  from: Date
  to: Date
  granularity: Granularity
}): Promise<{ result: WindowComputation; periods: Period[] }> {
  const { ctx, stores, from, to, granularity } = input
  const periods = buildPeriods(from, to, granularity)
  if (periods.length === 0 || stores.length === 0) {
    const empty: WindowComputation = {
      rows: [],
      totals: buildTotals({
        rows: [],
        orderCount: 0,
        targetCogsPct: null,
        fixedCostsTotal: 0,
      }),
      perStore: [],
      channelMix: [],
      caveats: [],
    }
    return { result: empty, periods }
  }

  const storeIds = stores.map((s) => s.id)
  const overallStart = periods[0].startDate
  const overallEnd = periods[periods.length - 1].endDate

  const [summaries, cogsRows] = await Promise.all([
    ctx.prisma.otterDailySummary.findMany({
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
        fpOrderCount: true,
        tpOrderCount: true,
      },
    }),
    ctx.prisma.dailyCogsItem.findMany({
      where: {
        storeId: { in: storeIds },
        date: { gte: overallStart, lte: overallEnd },
      },
      select: {
        storeId: true,
        date: true,
        lineCost: true,
        status: true,
      },
    }),
  ])

  const summariesByStore = new Map<string, SummaryRow[]>()
  for (const s of summaries as SummaryRow[]) {
    const arr = summariesByStore.get(s.storeId) ?? []
    arr.push(s)
    summariesByStore.set(s.storeId, arr)
  }
  const cogsByStore = new Map<string, CogsRow[]>()
  for (const r of cogsRows as CogsRow[]) {
    const arr = cogsByStore.get(r.storeId) ?? []
    arr.push(r)
    cogsByStore.set(r.storeId, arr)
  }

  const perStore: PnlStoreBlock[] = []
  const refillCaveats = new Set<string>()
  const laborMissing: string[] = []

  for (const store of stores) {
    const storeSummaries = summariesByStore.get(store.id) ?? []
    const storeCogs = cogsByStore.get(store.id) ?? []
    const bucketed = bucketSummariesByPeriod(storeSummaries, periods)
    const { cogsValues, rowCountPerPeriod } = bucketCogs(storeCogs, periods)
    const orderCounts = bucketOrderCount(storeSummaries, periods)
    const orderCount = sum(orderCounts)

    const computed = computeStorePnL({
      bucketed,
      periods,
      store,
      cogsValues,
    })

    // Refill-gap detection: any period with sales but no cogs rows.
    for (let i = 0; i < periods.length; i++) {
      if (rowCountPerPeriod[i] === 0 && computed.totalSales[i] > 0) {
        refillCaveats.add(`${store.name}: ${ymd(periods[i].startDate)} → ${ymd(periods[i].endDate)}`)
      }
    }

    if (store.fixedMonthlyLabor == null) laborMissing.push(store.name)

    const fixedCostsTotal =
      sum(computed.laborValues) +
      sum(computed.rentValues) +
      sum(computed.cleaningValues) +
      sum(computed.towelsValues)

    const totalChannelVals = computed.perPeriodSalesValues.reduce<number[]>(
      (acc, periodVals) => {
        for (let i = 0; i < periodVals.length; i++) {
          acc[i] = (acc[i] ?? 0) + periodVals[i]
        }
        return acc
      },
      [],
    )
    const channelGrossTotal = sum(totalChannelVals)
    const storeChannelMix = channelMix(totalChannelVals).map((c) => ({
      channel: c.channel,
      amount: c.amount,
      pctOfTotal: channelGrossTotal > 0 ? c.amount / channelGrossTotal : 0,
    }))

    const totals = buildTotals({
      rows: computed.rows,
      orderCount,
      targetCogsPct: store.targetCogsPct,
      fixedCostsTotal,
    })

    perStore.push({
      storeId: store.id,
      storeName: store.name,
      rows: computed.rows,
      totals,
      channelMix: storeChannelMix,
    })
  }

  const combinedRows = combineRows(
    perStore.map((s) => s.rows),
    periods.length,
  )

  // Window-level salesByStore for weighted-target computation.
  const salesByStore = new Map<string, number>()
  for (const block of perStore) {
    salesByStore.set(block.storeId, block.totals.grossSales)
  }
  const target = weightedTarget(stores, salesByStore)
  const combinedFixedCostsTotal = sum(perStore.map((s) => s.totals.fixedCostsTotal))
  const combinedOrderCount = sum(perStore.map((s) => s.totals.orderCount))

  const totals = buildTotals({
    rows: combinedRows,
    orderCount: combinedOrderCount,
    targetCogsPct: target,
    fixedCostsTotal: combinedFixedCostsTotal,
  })

  // Combined channelMix sums per-store amounts.
  const combinedChannelTotals = new Map<string, number>()
  for (const block of perStore) {
    for (const c of block.channelMix) {
      combinedChannelTotals.set(c.channel, (combinedChannelTotals.get(c.channel) ?? 0) + c.amount)
    }
  }
  const combinedChannelGrand = Array.from(combinedChannelTotals.values()).reduce((a, b) => a + b, 0)
  const combinedChannelMix: PnlChannelCell[] = Array.from(combinedChannelTotals.entries())
    .filter(([, amt]) => amt > 0)
    .map(([channel, amount]) => ({
      channel,
      amount,
      pctOfTotal: combinedChannelGrand > 0 ? amount / combinedChannelGrand : 0,
    }))

  const caveats: string[] = []
  if (laborMissing.length > 0) {
    caveats.push(
      `Labor not configured for: ${laborMissing.join(", ")} — labor totals exclude these stores.`,
    )
  }
  if (totals.laborDollars > 0) {
    caveats.push(
      "Labor figures are budgeted (fixed monthly amount pro-rated by days), not actual hours worked.",
    )
  }
  if (refillCaveats.size > 0) {
    const sample = Array.from(refillCaveats).slice(0, 3).join("; ")
    const more = refillCaveats.size > 3 ? ` (+${refillCaveats.size - 3} more)` : ""
    caveats.push(`COGS not yet refilled for: ${sample}${more}.`)
  }

  return {
    result: {
      rows: combinedRows,
      totals,
      perStore,
      channelMix: combinedChannelMix,
      caveats,
    },
    periods,
  }
}

export const getPnlSummary: ChatTool<typeof params, PnlSummaryResult> = {
  name: "getPnlSummary",
  description:
    "Full P&L for an owner-scoped slice of stores and a date range. Returns the complete row matrix (every GL sales line, commissions, COGS, gross profit, labor, rent, cleaning, towels, bottom line) plus pre-rolled totals (cogsPct, laborPct, marginPct, breakEvenSales, avgTicket, cashSales/cardSales, vsTargetPp), perStore breakdown, channelMix, and an optional comparePrevious window. ONE call answers most P&L questions — pick the right field/row from the result, do not call again per line item. Sign convention: in rows[].values[], sales are positive; commissions/COGS/labor/rent/cleaning/towels are negative. The totals block returns positive magnitudes for cost fields. Labor is a fixed monthly budget pro-rated by days, not actual hours.",
  parameters: params,
  async execute(args: Params, ctx) {
    const storeIds = await resolveStoreIds(ctx, args.storeIds)
    const { from, to } = parseDateRange(args.dateRange)
    const granularity: Granularity =
      args.granularity ?? defaultGranularity(from, to)

    const stores = (await ctx.prisma.store.findMany({
      where: { id: { in: storeIds }, isActive: true },
      select: {
        id: true,
        name: true,
        fixedMonthlyLabor: true,
        fixedMonthlyRent: true,
        fixedMonthlyTowels: true,
        fixedMonthlyCleaning: true,
        uberCommissionRate: true,
        doordashCommissionRate: true,
        targetCogsPct: true,
      },
      orderBy: { name: "asc" },
    })) as StoreFixed[]

    const { result, periods } = await computeWindow({
      ctx,
      stores,
      from,
      to,
      granularity,
    })

    const periodsOut: PnlPeriodCell[] = periods.map((p) => ({
      label: p.label,
      startDate: ymd(p.startDate),
      endDate: ymd(p.endDate),
      days: p.days,
      isPartial: p.isPartial,
    }))

    let previousPeriod: PnlSummaryResult["previousPeriod"]
    if (args.comparePrevious && periods.length > 0) {
      const span = to.getTime() - from.getTime()
      const priorTo = new Date(from.getTime() - 86_400_000) // day before `from`
      const priorFrom = new Date(priorTo.getTime() - span)
      const prior = await computeWindow({
        ctx,
        stores,
        from: priorFrom,
        to: priorTo,
        granularity,
      })
      const cur = result.totals
      const prev = prior.result.totals
      previousPeriod = {
        totals: prev,
        deltas: {
          grossSalesDollars: cur.grossSales - prev.grossSales,
          cogsPp: cur.cogsPct - prev.cogsPct,
          laborPp: cur.laborPct - prev.laborPct,
          marginPp: cur.netMarginPct - prev.netMarginPct,
          bottomLineDollars: cur.bottomLine - prev.bottomLine,
          orderCountDelta: cur.orderCount - prev.orderCount,
          avgTicketDelta: cur.avgTicket - prev.avgTicket,
        },
      }
    }

    return {
      scope: {
        storeCount: stores.length,
        storeNames: stores.map((s) => s.name),
        dateFrom: ymd(from),
        dateTo: ymd(to),
        granularity,
      },
      rows: result.rows,
      periods: periodsOut,
      totals: result.totals,
      channelMix: result.channelMix,
      perStore: stores.length > 1 ? result.perStore : undefined,
      previousPeriod,
      caveats: result.caveats,
    }
  },
}

