import { isAfter, isBefore } from "date-fns"
import { hasFixedLabor } from "@/lib/counter/labor-cost-core"
// UTC-floor on purpose: OtterDailySummary.date is a Postgres @db.Date stored
// at UTC midnight (e.g. May 1 LA business day → 2026-05-01T00:00:00Z).
// Period boundaries must land on the same instant or bucketSummariesByPeriod
// drops every row when the server runs in non-UTC TZ (e.g. local dev in PDT).
// Every date op below (not just the initial floor) must stay in UTC, or a
// period boundary drifts off midnight and either drops rows (DST) or mislabels
// the day (any negative offset) — isAfter/isBefore are the exception, since
// they compare instants and are already timezone-safe.
import {
  COMMISSION_LINES,
  estimateFromSales,
  salesSlices,
  type CommissionLine,
  type CommissionTotals,
  type PeriodCommission,
  type SalesSlice,
} from "@/lib/counter/commission-core"
import {
  addDaysUTC as addDays,
  differenceInCalendarDaysUTC as differenceInCalendarDays,
  endOfMonthUTC as endOfMonth,
  endOfWeekUTC as endOfWeek,
  formatUTC as format,
  startOfDayUTC as startOfDay,
  startOfMonthUTC as startOfMonth,
  startOfWeekUTC as startOfWeek,
} from "@/lib/date-utils"

export type Granularity = "daily" | "weekly" | "monthly"

export interface Period {
  label: string
  startDate: Date
  endDate: Date
  days: number
  isPartial: boolean
}

export interface PnLRow {
  code: string
  label: string
  values: number[]
  percents: number[]
  isSubtotal?: boolean
  isFixed?: boolean
  /** True when the value represents "unknown / not configured" rather than zero. */
  isUnknown?: boolean[]
  /**
   * A memo line printed for information and NOT part of any sum — sales tax
   * collected, which Otter's gross already excludes. Nothing that totals rows
   * may add it in.
   */
  isMemo?: boolean
}

// ─── GL row metadata ───

export const UBER_ROW_INDEX = 2
export const DOORDASH_ROW_INDEX = 3

/**
 * The sales lines, in order. Every one of them is part of Net Sales: the sum
 * of `salesRowValues` IS Total Sales, by construction, so nothing that totals
 * these lines can disagree with the statement.
 *
 * Sales tax (4100) is NOT here any more. Otter's `fpGrossSales` /
 * `tpGrossSales` EXCLUDE tax — measured 2026-10-28: per store and platform,
 * gross + discounts + `tpRefundsAdjustments` reconciles to Otter's net to the
 * dollar, and in-house gross matches Σ `OtterOrder.subtotal` with tax stored
 * apart — so posting tax as a negative line understated Total Sales by the
 * whole tax (~8%, ~$17k a month at Hollywood). Tax is now a memo row
 * (`TAX_MEMO_CODE`) printed after Net Sales and summed into nothing.
 */
export const GL_ROWS = [
  { code: "4010", label: "SALES-FOOD - Credit Cards" },
  { code: "4011", label: "SALES-FOOD - Cash" },
  { code: "4012", label: "SALES-FOOD - Uber" },
  { code: "4013", label: "SALES-FOOD - Doordash" },
  { code: "4014", label: "SALES-FOOD - Grubhub" },
  { code: "4015", label: "SALES-FOOD - Chownow" },
  { code: "4015C", label: "SALES-FOOD - Caviar" },
  { code: "4016", label: "SALES-FOOD - EZ Cater" },
  { code: "4017", label: "SALES-FOOD - Fooda" },
  { code: "4018", label: "SALES-FOOD - Otter Online" },
  { code: "4018P", label: "SALES-FOOD - Otter Prepaid" },
  { code: "4020", label: "SALES-BEVERAGE" },
  { code: "4040", label: "SERVICE CHARGE" },
  { code: "4110", label: "DISCOUNTS (GUEST)" },
  { code: "4120", label: "REFUNDS & ADJUSTMENTS" },
] as const

/** Index of the last line that is part of GROSS sales (service charge); discounts and refunds follow. */
const GROSS_LINE_COUNT = 13

// The four channel sales lines `channel-series.ts` reads to build the mix —
// named here so a second file never spells the GL code as a string literal.
export const SALES_CREDIT_CARDS_CODE = "4010"
export const SALES_CASH_CODE = "4011"
export const SALES_UBER_CODE = "4012"
export const SALES_DOORDASH_CODE = "4013"
export const SALES_GRUBHUB_CODE = "4014"
export const SALES_PREPAID_CODE = "4018P"
export const DISCOUNTS_CODE = "4110"
export const REFUNDS_CODE = "4120"
/** Sales tax collected — a memo row, outside every total. See `GL_ROWS`. */
export const TAX_MEMO_CODE = "4100"
/** Gross sales before discounts and refunds: the channel lines plus service charges. */
export const GROSS_SALES_CODE = "GROSS_SALES"

/** Net sales: gross less discounts and refunds. The denominator of every percent on the statement. */
export const TOTAL_SALES_CODE = "TOTAL_SALES"
export const UBER_COMMISSION_CODE = "COM_UBER"
export const DOORDASH_COMMISSION_CODE = "COM_DD"
export const GRUBHUB_COMMISSION_CODE = "COM_GH"
/** ChowNow, Caviar and any other marketplace. Emitted only when one traded. */
export const OTHER_COMMISSION_CODE = "COM_OTHER"
export const NET_AFTER_COMMISSIONS_CODE = "NET_COM"
export const COGS_CODE = "6100"
export const GROSS_PROFIT_CODE = "GROSS_PROFIT"
export const LABOR_CODE = "6200"
export const RENT_CODE = "7200"
export const CLEANING_CODE = "7210"
export const TOWELS_CODE = "7220"
export const AFTER_LABOR_RENT_CODE = "AFTER_FIXED"

// ─── Period bucket generation ───

/**
 * Build the list of period buckets covering [startDate, endDate] at the given granularity.
 * Boundaries are snapped to week / month edges; buckets at the range edges may be partial.
 */
export function buildPeriods(
  startDate: Date,
  endDate: Date,
  granularity: Granularity
): Period[] {
  const periods: Period[] = []
  const rangeStart = startOfDay(startDate)
  const rangeEnd = startOfDay(endDate)

  if (isAfter(rangeStart, rangeEnd)) return periods

  if (granularity === "daily") {
    let cursor = rangeStart
    while (!isAfter(cursor, rangeEnd)) {
      periods.push({
        label: format(cursor, "EEE MMM d"),
        startDate: cursor,
        endDate: cursor,
        days: 1,
        isPartial: false,
      })
      cursor = addDays(cursor, 1)
    }
    return periods
  }

  if (granularity === "weekly") {
    let weekStart = startOfWeek(rangeStart, 0) // Sunday
    while (!isAfter(weekStart, rangeEnd)) {
      const weekEnd = endOfWeek(weekStart, 0)
      const bucketStart = isBefore(weekStart, rangeStart) ? rangeStart : weekStart
      const bucketEnd = isAfter(weekEnd, rangeEnd) ? rangeEnd : weekEnd
      const days = differenceInCalendarDays(bucketEnd, bucketStart) + 1
      const isPartial = days < 7
      periods.push({
        label: isPartial
          ? `${format(bucketStart, "MMM d")} → ${format(bucketEnd, "MMM d")} (${days}d, partial)`
          : `Week of ${format(weekStart, "MMM d")}`,
        startDate: bucketStart,
        endDate: bucketEnd,
        days,
        isPartial,
      })
      weekStart = addDays(weekStart, 7)
    }
    return periods
  }

  // monthly
  let monthStart = startOfMonth(rangeStart)
  while (!isAfter(monthStart, rangeEnd)) {
    const monthEnd = endOfMonth(monthStart)
    const bucketStart = isBefore(monthStart, rangeStart) ? rangeStart : monthStart
    const bucketEnd = isAfter(monthEnd, rangeEnd) ? rangeEnd : monthEnd
    const days = differenceInCalendarDays(bucketEnd, bucketStart) + 1
    const fullMonthDays = differenceInCalendarDays(monthEnd, monthStart) + 1
    const isPartial = days < fullMonthDays
    periods.push({
      label: isPartial
        ? `${format(monthStart, "MMM yyyy")} (${days}d)`
        : format(monthStart, "MMM yyyy"),
      startDate: bucketStart,
      endDate: bucketEnd,
      days,
      isPartial,
    })
    monthStart = startOfMonth(addDays(monthEnd, 1))
  }
  return periods
}

// ─── Fixed-cost conversion ───

const DAYS_PER_MONTH = 365.25 / 12 // ≈ 30.4375

/**
 * Convert a monthly fixed-cost figure to the amount applicable to a period of
 * `days` days.
 *
 * The divisor is the AVERAGE month — 365.25/12 ≈ 30.4375 days — because the
 * caller's window is arbitrary: a 7-day range, a 22-day range, a range that
 * straddles two months. There is no month to be a fraction of, so an average
 * one is the only answer that is stable across windows and sums to the year.
 *
 * What that costs: a calendar month does NOT come back at its own figure. A
 * 31-day month prorates to 1.85% over the real rent and February to about 8%
 * under, and month-to-date rent, cleaning, towels and the fixed-labour
 * fallback all carry it. This docblock used to claim "full-month values match
 * exactly", which they never did — stated here because someone will otherwise
 * reconcile a month against a landlord's invoice and go looking for the
 * difference in the data.
 */
export function monthlyCostForDays(
  monthlyAmount: number | null | undefined,
  days: number
): number | null {
  if (monthlyAmount == null) return null
  return (monthlyAmount * days) / DAYS_PER_MONTH
}

const WEEKS_PER_YEAR = 52
const MONTHS_PER_YEAR = 12

/** Convert a weekly recurring cost to its monthly equivalent (weekly × 52 / 12). */
export function monthlyFromWeekly(weekly: number): number {
  return (weekly * WEEKS_PER_YEAR) / MONTHS_PER_YEAR
}

/** Inverse of monthlyFromWeekly — useful for seeding a "weekly" form field from a stored monthly value. */
export function weeklyFromMonthly(monthly: number): number {
  return (monthly * MONTHS_PER_YEAR) / WEEKS_PER_YEAR
}

export type ExpenseFrequency = "WEEKLY" | "MONTHLY" | "YEARLY"

/**
 * Normalize an owner-entered fixed-expense amount in its chosen cadence to a
 * monthly figure, so it can be prorated per P&L period via monthlyCostForDays.
 */
export function monthlyFromFrequency(
  amount: number,
  frequency: ExpenseFrequency
): number {
  switch (frequency) {
    case "WEEKLY":
      return monthlyFromWeekly(amount)
    case "YEARLY":
      return amount / MONTHS_PER_YEAR
    case "MONTHLY":
    default:
      return amount
  }
}

/** Row-code prefix for owner-managed custom fixed expenses (one row per expense). */
export const CUSTOM_FIXED_CODE_PREFIX = "FX_"

// ─── Sum helpers for Otter rows ───

export type OtterSummaryRow = {
  platform: string
  paymentMethod: string
  fpGrossSales: number | null
  tpGrossSales: number | null
  fpTaxCollected: number | null
  tpTaxCollected: number | null
  fpDiscounts: number | null
  tpDiscounts: number | null
  fpServiceCharges: number | null
  tpServiceCharges: number | null
  /** Signed: refunds and adjustments arrive NEGATIVE. Optional so older callers still type-check. */
  tpRefundsAdjustments?: number | null
}

const FP_PLATFORMS = new Set(["css-pos", "bnm-web"])

/**
 * What one summary row contributes to the statement — the one place a
 * channel's "net sales" is defined.
 *
 *   gross    = fpGrossSales on an in-house platform, tpGrossSales elsewhere
 *   + service charges (fp + tp)
 *   + discounts       (fp + tp, signed negative — not negated)
 *   + refunds         (tpRefundsAdjustments, signed negative)
 *   = net
 *
 * Tax is returned beside it and is in none of the above. Summing `net` over
 * any set of rows gives the same Net Sales `salesRowValues` totals for them,
 * so a per-channel net and the statement cannot disagree.
 */
export function rowSales(r: Omit<OtterSummaryRow, "paymentMethod"> & { paymentMethod?: string }): {
  gross: number
  serviceCharges: number
  discounts: number
  refunds: number
  net: number
  tax: number
} {
  const gross = (FP_PLATFORMS.has(r.platform) ? r.fpGrossSales : r.tpGrossSales) ?? 0
  const serviceCharges = (r.fpServiceCharges ?? 0) + (r.tpServiceCharges ?? 0)
  const discounts = (r.fpDiscounts ?? 0) + (r.tpDiscounts ?? 0)
  const refunds = r.tpRefundsAdjustments ?? 0
  const tax = (r.fpTaxCollected ?? 0) + (r.tpTaxCollected ?? 0)
  return { gross, serviceCharges, discounts, refunds, net: gross + serviceCharges + discounts + refunds, tax }
}

/**
 * The daily summary as commission slices (store/day/platform): the
 * marketplace order count and the commissionable sales, gross + discounts +
 * refunds (service charges are not commissioned). `commission-core`'s
 * `cellsOf` uses them to price days whose order rows are missing or partial.
 */
export function summarySlices(
  rows: Array<
    Omit<OtterSummaryRow, "paymentMethod"> & {
      storeId: string
      date: Date | string
      tpOrderCount?: number | null
    }
  >,
): SalesSlice[] {
  return salesSlices(
    rows.map((r) => {
      const s = rowSales(r)
      return {
        storeId: r.storeId,
        date: r.date,
        platform: r.platform,
        orders: r.tpOrderCount ?? 0,
        net: s.gross + s.discounts + s.refunds,
      }
    }),
  )
}

/** Sum-by-predicate over a list of Otter rows. Treats null as 0. */
function sumBy(
  rows: OtterSummaryRow[],
  pick: (r: OtterSummaryRow) => number | null | undefined,
  where: (r: OtterSummaryRow) => boolean = () => true
): number {
  let s = 0
  for (const r of rows) {
    if (!where(r)) continue
    const v = pick(r)
    if (v != null) s += v
  }
  return s
}

/** The GL line an in-house payment method posts to. PREPAID (gift cards, house accounts) is 4018P. */
function houseLine(paymentMethod: string): number {
  if (paymentMethod === "CASH") return 1 // 4011
  if (paymentMethod === "PREPAID") return 10 // 4018P
  return 0 // 4010 — CARD, and any method Otter adds next, rather than dropping it
}

const TP_LINE: Record<string, number> = {
  ubereats: 2,
  doordash: 3,
  grubhub: 4,
  chownow: 5,
  caviar: 6,
  ezcater: 7,
  fooda: 8,
}

/**
 * Map a bucket of OtterDailySummary rows to the GL sales lines.
 * Returns an array of length GL_ROWS.length, in the same order, whose SUM is
 * Net Sales (see `rowSales`).
 *
 * In-house: EVERY payment method on an in-house platform counts — CARD to
 * 4010, CASH to 4011, PREPAID to 4018P (about $700 a month on css-pos, which
 * used to be dropped), anything else to 4010. A marketplace with no line of
 * its own posts to 4018 "Otter Online" rather than vanishing while its
 * discounts still counted.
 */
export function salesRowValues(rows: OtterSummaryRow[]): number[] {
  const out = GL_ROWS.map(() => 0)
  for (const r of rows) {
    const s = rowSales(r)
    const line = FP_PLATFORMS.has(r.platform)
      ? houseLine(r.paymentMethod)
      : (TP_LINE[r.platform] ?? 9) // 4018
    out[line] += s.gross
    out[12] += s.serviceCharges // 4040
    out[13] += s.discounts // 4110
    out[14] += s.refunds // 4120
  }
  return out
}

/** Sales tax collected over a bucket — the memo row, never in a total. */
export function taxCollected(rows: OtterSummaryRow[]): number {
  return rows.reduce((t, r) => t + rowSales(r).tax, 0)
}

/** Net sales per commission line over a bucket — the base the fallback estimate prices. */
function salesByCommissionLine(rows: OtterSummaryRow[]): Record<CommissionLine, number> {
  const out: Record<CommissionLine, number> = { ubereats: 0, doordash: 0, grubhub: 0, other: 0 }
  for (const r of rows) {
    if (FP_PLATFORMS.has(r.platform)) continue
    const s = rowSales(r)
    const line: CommissionLine =
      r.platform === "ubereats" || r.platform === "doordash" || r.platform === "grubhub"
        ? r.platform
        : "other"
    out[line] += s.gross + s.discounts
  }
  return out
}

/**
 * Compute % of Total Sales for each value. Returns 0 when there are no sales.
 *
 * See `pctOfSales` for why the guard is `<= 0` and not `=== 0`.
 */
export function percents(values: number[], total: number): number[] {
  if (total <= 0) return values.map(() => 0)
  return values.map((v) => v / total)
}

/**
 * One value as a share of that period's Total Sales.
 *
 * The one function that owns the P&L percent column. Fourteen copies of
 * `totalSales[i] === 0 ? 0 : v / totalSales[i]` stood in this file, and every
 * one of them divided by a denominator it had only checked for exact zero.
 *
 * Total Sales for a period CAN be negative — a day of refunds against a
 * closed range, a correction posted after the fact, a store that traded one
 * void. A negative denominator does not throw and does not produce Infinity;
 * it silently flips the sign of every line in the column. COGS of $4,000 on
 * Total Sales of −$200 printed as +2000% food cost, and Net Income of −$900
 * printed as a positive margin. The owner reads that column to decide whether
 * a store is making money.
 *
 * Zero is the fallback rather than null because `PnLRow.percents` is
 * `number[]`; the row's `isUnknown` flags carry "not configured" separately.
 */
export function pctOfSales(value: number, totalSales: number): number {
  return totalSales <= 0 ? 0 : value / totalSales
}

// ─── Channel mix helpers ───

export const CHANNEL_LABELS = [
  "Credit Cards",
  "Cash",
  "Uber",
  "DoorDash",
  "Grubhub",
  "ChowNow",
  "Caviar",
  "EZ Cater",
  "Fooda",
  "Otter Online",
  "Otter Prepaid",
  "Beverage",
] as const

/** Extract channel-mix entries (first 11 GL rows, excluding Service Charge / Tax / Discounts). */
export function channelMix(salesValues: number[]): Array<{ channel: string; amount: number }> {
  return CHANNEL_LABELS.map((label, i) => ({ channel: label, amount: salesValues[i] ?? 0 }))
    .filter((e) => e.amount > 0)
}

// ─── Core P&L computation (shared by per-store and all-stores actions) ───

export interface StoreFixedInputs {
  id?: string
  fixedMonthlyLabor: number | null
  fixedMonthlyRent: number | null
  fixedMonthlyTowels: number | null
  fixedMonthlyCleaning: number | null
  /** Delivery rates. See `commission-core.ts` — used only by the no-orders fallback here. */
  uberCommissionRate: number
  doordashCommissionRate: number
  uberPickupCommissionRate?: number | null
  doordashPickupCommissionRate?: number | null
  grubhubCommissionRate?: number | null
}

export interface ComputedPnL {
  rows: PnLRow[]
  perPeriodSalesValues: number[][]
  /** Net sales — gross less discounts and refunds. The name predates the fix and is kept for its callers. */
  totalSales: number[]
  /** Gross sales before discounts and refunds (channel lines + service charges). */
  grossBeforeDiscounts: number[]
  /** Signed negative. */
  discounts: number[]
  /** Signed: negative is money given back. */
  refunds: number[]
  /** Sales tax collected. Memo only — in no total. */
  taxCollected: number[]
  uberCommission: number[] // already negative
  doordashCommission: number[] // already negative
  grubhubCommission: number[] // already negative
  otherCommission: number[] // already negative
  /** Per period, the commission behind the four lines, with its coverage. */
  commission: PeriodCommission[]
  netAfterCommissions: number[]
  cogsValues: number[] // positive magnitude (may be 0s if no recipes)
  grossProfit: number[]
  laborValues: number[] // positive magnitude
  rentValues: number[] // positive magnitude
  towelsValues: number[] // positive magnitude
  cleaningValues: number[] // positive magnitude
  /** Per custom fixed expense, the per-period positive magnitude (one inner
   *  array per entry in `customFixedExpenses`, in the same order). */
  customFixedValues: number[][]
  bottomLine: number[]
}

/** One owner-managed custom fixed expense, already normalized to a monthly figure. */
export interface CustomFixedExpense {
  /** Unique row code, e.g. `FX_<id>`. Used as the PnLRow.code. */
  code: string
  label: string
  /** Monthly figure (caller normalizes cadence via monthlyFromFrequency). */
  monthlyAmount: number
}

/** Per-period Harri labor actuals. Pass to computeStorePnL to override the
 *  fixed-monthly labor estimate with real numbers from /lib/harri-labor-sync. */
export type HarriLaborByPeriod = {
  /** Labor dollars for the days in the period that have a reading — `loadLaborCost`'s rule. */
  actualUsd: number
  /** Number of days in the period with a labor reading; the rest are missing, not $0. */
  coveredDays: number
}

/**
 * Pure: given bucketed Otter rows, periods, and store fixed-cost inputs,
 * produce the full PnL row array AND derived per-period KPI arrays.
 */
export function computeStorePnL(input: {
  bucketed: OtterSummaryRow[][]
  periods: Period[]
  store: StoreFixedInputs
  /** Optional per-period COGS (positive magnitude). When provided, a COGS row and
   *  Gross Profit subtotal are inserted between Net Sales After Commissions and Labor,
   *  and the bottom line subtracts COGS too. */
  cogsValues?: number[]
  /** Optional per-period Harri labor actuals. When supplied (one entry per
   *  period), the labor row uses real Harri data with coverage-aware fallback
   *  to fixedMonthlyLabor for uncovered days. */
  harriLaborByPeriod?: HarriLaborByPeriod[]
  /** Optional owner-managed custom fixed expenses. Each becomes one prorated
   *  `isFixed` row (code `FX_<id>`) after Towels, and reduces the bottom line. */
  customFixedExpenses?: CustomFixedExpense[]
  /**
   * Per-period commission from `bucketCommission` (`@/lib/counter/commission`)
   * — recorded fees plus the store-rate estimate for orders without one.
   * Every page caller passes it. Absent, each platform is estimated at the
   * store's delivery rate on its after-discount sales, the same rule with
   * nothing recorded.
   */
  commission?: PeriodCommission[]
}): ComputedPnL {
  const { bucketed, periods, store, cogsValues, harriLaborByPeriod } = input
  const customFixedExpenses = input.customFixedExpenses ?? []

  const perPeriodSalesValues = bucketed.map((rows) => salesRowValues(rows))
  const totalSales = perPeriodSalesValues.map((vals) => vals.reduce((a, b) => a + b, 0))
  const grossBeforeDiscounts = perPeriodSalesValues.map((vals) =>
    vals.slice(0, GROSS_LINE_COUNT).reduce((a, b) => a + b, 0)
  )
  const discounts = perPeriodSalesValues.map((v) => v[13])
  const refunds = perPeriodSalesValues.map((v) => v[14])
  const tax = bucketed.map((rows) => taxCollected(rows))

  const glRow = (rowIdx: number): PnLRow => {
    const meta = GL_ROWS[rowIdx]
    const values = perPeriodSalesValues.map((v) => v[rowIdx])
    return {
      code: meta.code,
      label: meta.label,
      values,
      percents: values.map((v, i) => pctOfSales(v, totalSales[i])),
    }
  }

  const rows: PnLRow[] = []
  for (let i = 0; i < GROSS_LINE_COUNT; i++) rows.push(glRow(i))
  rows.push({
    code: GROSS_SALES_CODE,
    label: "Gross Sales",
    values: grossBeforeDiscounts,
    percents: grossBeforeDiscounts.map((v, i) => pctOfSales(v, totalSales[i])),
    isSubtotal: true,
  })
  for (let i = GROSS_LINE_COUNT; i < GL_ROWS.length; i++) rows.push(glRow(i))

  rows.push({
    code: TOTAL_SALES_CODE,
    label: "Net Sales",
    values: totalSales,
    percents: totalSales.map(() => 1),
    isSubtotal: true,
  })
  rows.push({
    code: TAX_MEMO_CODE,
    label: "Sales tax collected (not in sales)",
    values: tax,
    percents: tax.map((v, i) => pctOfSales(v, totalSales[i])),
    isMemo: true,
  })

  const commission: PeriodCommission[] =
    input.commission && input.commission.length === periods.length
      ? input.commission
      : bucketed.map((rows) => estimateFromSales(salesByCommissionLine(rows), store))
  const lineSales = bucketed.map((rows) => salesByCommissionLine(rows))

  const commissionLine = (line: CommissionLine) => {
    const values = commission.map((c) => -(c[line].amount ?? 0))
    // Unknown when the figure is short of something: orders with no fee and
    // no rate, a platform no rate covers, or marketplace sales with no orders
    // on file to price — that last is a sync gap, and $0 would hide it.
    const isUnknown = commission.map((c, i) => {
      const t: CommissionTotals = c[line]
      return t.amount === null || t.unknownOrders > 0 || (t.orders === 0 && t.amount === 0 && lineSales[i][line] > 0 && input.commission != null)
    })
    return { values, isUnknown }
  }

  const COMMISSION_ROWS: Array<{ line: CommissionLine; code: string; label: string }> = [
    { line: "ubereats", code: UBER_COMMISSION_CODE, label: "Uber Eats commission" },
    { line: "doordash", code: DOORDASH_COMMISSION_CODE, label: "DoorDash commission" },
    { line: "grubhub", code: GRUBHUB_COMMISSION_CODE, label: "Grubhub commission" },
    { line: "other", code: OTHER_COMMISSION_CODE, label: "Other marketplace commission" },
  ]
  const byLine = {} as Record<CommissionLine, number[]>
  for (const r of COMMISSION_ROWS) {
    const { values, isUnknown } = commissionLine(r.line)
    byLine[r.line] = values
    const traded = commission.some((c) => c[r.line].orders > 0) || lineSales.some((s) => s[r.line] !== 0)
    if (r.line === "other" && !traded) continue
    rows.push({
      code: r.code,
      label: r.label,
      values,
      percents: values.map((v, i) => pctOfSales(v, totalSales[i])),
      isFixed: true,
      isUnknown: isUnknown.some(Boolean) ? isUnknown : undefined,
    })
  }
  const uberCommission = byLine.ubereats
  const doordashCommission = byLine.doordash
  const grubhubCommission = byLine.grubhub
  const otherCommission = byLine.other

  const netAfterCommissions = totalSales.map(
    (ts, i) => ts + COMMISSION_LINES.reduce((acc, line) => acc + byLine[line][i], 0)
  )
  rows.push({
    code: NET_AFTER_COMMISSIONS_CODE,
    label: "Net Sales After Commissions",
    values: netAfterCommissions,
    percents: netAfterCommissions.map((v, i) => pctOfSales(v, totalSales[i])),
    isSubtotal: true,
  })

  const cogs = cogsValues ?? periods.map(() => 0)
  const grossProfit = netAfterCommissions.map((n, i) => n - cogs[i])

  if (cogsValues) {
    rows.push({
      code: COGS_CODE,
      label: "Cost of Goods Sold",
      values: cogs.map((v) => -v),
      percents: cogs.map((v, i) => pctOfSales(-v, totalSales[i])),
    })
    rows.push({
      code: GROSS_PROFIT_CODE,
      label: "Gross Profit",
      values: grossProfit,
      percents: grossProfit.map((v, i) => pctOfSales(v, totalSales[i])),
      isSubtotal: true,
    })
  }

  // ─── Labor row ───
  // Coverage-aware blend: Harri actuals for covered days + per-day fixed
  // estimate for the rest. Label reflects overall coverage across the
  // requested period range.
  // A stored 0 is how the store file saves a budget nobody entered: it is
  // "not set", same as null, so it neither prices uncovered days at $0 as if
  // known nor reads as a configured budget.
  const fixedLabor = hasFixedLabor(store.fixedMonthlyLabor) ? store.fixedMonthlyLabor : null
  const fixedLaborByPeriod = periods.map(
    (p) => monthlyCostForDays(fixedLabor, p.days) ?? 0
  )
  let laborValues: number[]
  let laborLabel = "Labor (fixed)"
  let laborUnknown: boolean[]
  if (harriLaborByPeriod && harriLaborByPeriod.length === periods.length) {
    laborValues = periods.map((p, i) => {
      const h = harriLaborByPeriod[i]
      const days = p.days
      if (days <= 0) return 0
      const covered = Math.max(0, Math.min(days, h.coveredDays))
      if (covered === 0) {
        return fixedLaborByPeriod[i]
      }
      // Estimate uncovered portion proportionally from monthly fixed.
      const perDayFixed = days > 0 ? fixedLaborByPeriod[i] / days : 0
      const uncoveredEstimate = perDayFixed * (days - covered)
      return h.actualUsd + uncoveredEstimate
    })
    laborUnknown = periods.map((p, i) => {
      const h = harriLaborByPeriod[i]
      if (h.coveredDays >= p.days) return false
      /*
       * Partial / no Harri coverage falls back on fixed; flag as unknown when
       * the fixed estimate is also missing — whatever the coverage.
       *
       * This carried `&& h.coveredDays === 0`, which is not what the sentence
       * above it says and not what the arithmetic does. With no
       * `fixedMonthlyLabor`, `fixedLaborByPeriod[i]` is 0, so `perDayFixed` is
       * 0 and the uncovered days contribute NOTHING — not an estimate, an
       * omission. A store with three of seven days synced and no labour budget
       * on file reported a week's labour built from three days and called it
       * known. Labour understated means bottom line, margin and prime cost all
       * overstated, which is the direction nobody goes looking in.
       */
      return fixedLabor == null
    })
    const totalDays = periods.reduce((a, p) => a + p.days, 0)
    const totalCovered = harriLaborByPeriod.reduce((a, h) => a + Math.max(0, h.coveredDays), 0)
    if (totalDays > 0 && totalCovered / totalDays >= 0.8) laborLabel = "Labor (actual)"
    else if (totalCovered > 0) laborLabel = "Labor (partial)"
    else laborLabel = fixedLabor != null ? "Labor (fixed)" : "Labor (estimated)"
  } else {
    laborValues = fixedLaborByPeriod
    laborUnknown = periods.map(() => fixedLabor == null)
  }

  const rentValues = periods.map(
    (p) => monthlyCostForDays(store.fixedMonthlyRent, p.days) ?? 0
  )
  const cleaningValues = periods.map(
    (p) => monthlyCostForDays(store.fixedMonthlyCleaning, p.days) ?? 0
  )
  const towelsValues = periods.map(
    (p) => monthlyCostForDays(store.fixedMonthlyTowels, p.days) ?? 0
  )
  const rentUnknown = periods.map(() => store.fixedMonthlyRent == null)
  const cleaningUnknown = periods.map(() => store.fixedMonthlyCleaning == null)
  const towelsUnknown = periods.map(() => store.fixedMonthlyTowels == null)

  rows.push({
    code: LABOR_CODE,
    label: laborLabel,
    values: laborValues.map((v) => -v),
    percents: laborValues.map((v, i) => pctOfSales(-v, totalSales[i])),
    isFixed: true,
    isUnknown: laborUnknown,
  })
  rows.push({
    code: RENT_CODE,
    label: "Rent (fixed)",
    values: rentValues.map((v) => -v),
    percents: rentValues.map((v, i) => pctOfSales(-v, totalSales[i])),
    isFixed: true,
    isUnknown: rentUnknown,
  })
  rows.push({
    code: CLEANING_CODE,
    label: "Store Cleaning (fixed)",
    values: cleaningValues.map((v) => -v),
    percents: cleaningValues.map((v, i) => pctOfSales(-v, totalSales[i])),
    isFixed: true,
    isUnknown: cleaningUnknown,
  })
  rows.push({
    code: TOWELS_CODE,
    label: "Towels (fixed)",
    values: towelsValues.map((v) => -v),
    percents: towelsValues.map((v, i) => pctOfSales(-v, totalSales[i])),
    isFixed: true,
    isUnknown: towelsUnknown,
  })

  // ─── Custom owner-managed fixed expenses ───
  // One prorated row per expense (positive magnitude captured for KPI rollups).
  const customFixedValues = customFixedExpenses.map((exp) =>
    periods.map((p) => monthlyCostForDays(exp.monthlyAmount, p.days) ?? 0)
  )
  customFixedExpenses.forEach((exp, ei) => {
    const vals = customFixedValues[ei]
    rows.push({
      code: exp.code,
      label: exp.label,
      values: vals.map((v) => -v),
      percents: vals.map((v, i) => pctOfSales(-v, totalSales[i])),
      isFixed: true,
    })
  })
  const customFixedByPeriod = periods.map((_, i) =>
    customFixedValues.reduce((acc, arr) => acc + arr[i], 0)
  )

  const bottomLine = netAfterCommissions.map(
    (n, i) =>
      n -
      cogs[i] -
      laborValues[i] -
      rentValues[i] -
      cleaningValues[i] -
      towelsValues[i] -
      customFixedByPeriod[i]
  )
  rows.push({
    code: AFTER_LABOR_RENT_CODE,
    label: "Net After Commissions & Fixed Costs",
    values: bottomLine,
    percents: bottomLine.map((v, i) => pctOfSales(v, totalSales[i])),
    isSubtotal: true,
  })

  return {
    rows,
    perPeriodSalesValues,
    totalSales,
    grossBeforeDiscounts,
    discounts,
    refunds,
    taxCollected: tax,
    uberCommission,
    doordashCommission,
    grubhubCommission,
    otherCommission,
    commission,
    netAfterCommissions,
    cogsValues: cogs,
    grossProfit,
    laborValues,
    rentValues,
    towelsValues,
    cleaningValues,
    customFixedValues,
    bottomLine,
  }
}

/**
 * Merge per-store PnL row arrays into one consolidated set, keyed by row `code`.
 *
 * Unlike a positional merge, this is robust to stores that emit different rows
 * (e.g. different custom fixed expenses): each unique code appears once, summed
 * across only the stores that have it. Row order follows first appearance while
 * scanning stores in order, which preserves the canonical layout (GL → … →
 * fixed costs → custom expenses → AFTER_FIXED) since every store shares it.
 */
export function consolidateRows(
  perStoreRows: PnLRow[][],
  periods: Period[]
): PnLRow[] {
  // Combined Total Sales per period — denominator for consolidated percents.
  const combinedGrossPerPeriod = periods.map((_, pi) =>
    perStoreRows.reduce(
      (acc, rows) =>
        acc + (rows.find((r) => r.code === TOTAL_SALES_CODE)?.values[pi] ?? 0),
      0
    )
  )

  // First-seen ordered list of row templates, keyed by code.
  const order: string[] = []
  const template = new Map<string, PnLRow>()
  for (const rows of perStoreRows) {
    for (const r of rows) {
      if (!template.has(r.code)) {
        template.set(r.code, r)
        order.push(r.code)
      }
    }
  }

  return order.map((code) => {
    const meta = template.get(code)!
    // A label like "Labor (actual)" or "Labor (partial)" is a claim about one
    // store's data. `template` holds whichever store came first, so a
    // consolidated line was stamped with that store's state and read as a
    // claim about all of them. Where the contributing stores disagree, the
    // line takes the bare name.
    const labels = new Set(
      perStoreRows
        .map((rows) => rows.find((r) => r.code === code)?.label)
        .filter((l): l is string => l !== undefined)
    )
    const label =
      labels.size > 1 ? (meta.label.split(" (")[0] ?? meta.label) : meta.label
    const contributing = perStoreRows.filter((rows) =>
      rows.some((r) => r.code === code)
    )
    const values = periods.map((_, pi) =>
      perStoreRows.reduce(
        (acc, rows) => acc + (rows.find((r) => r.code === code)?.values[pi] ?? 0),
        0
      )
    )
    // Unknown when ANY contributing store is unknown, because the line is a
    // SUM and a store that does not know its figure contributes nothing to it.
    // Hollywood's $10k of rent plus Glendale's missing rent is a consolidated
    // Rent of $10k — Glendale's real rent has entered the group P&L as zero,
    // and the group bottom line is overstated by exactly that. The flag used
    // to require EVERY store to be unknown, which is the test for "we know
    // nothing about this line", not for "this total is short a store".
    const combinedUnknown = periods.map((_, pi) =>
      contributing.some(
        (rows) => rows.find((r) => r.code === code)?.isUnknown?.[pi] === true
      )
    )
    const anyUnknown = combinedUnknown.some(Boolean)
    return {
      code,
      label,
      values,
      percents: values.map((v, i) => pctOfSales(v, combinedGrossPerPeriod[i])),
      isSubtotal: meta.isSubtotal,
      isFixed: meta.isFixed,
      isMemo: meta.isMemo,
      isUnknown: anyUnknown ? combinedUnknown : undefined,
    }
  })
}

/** Bucket OtterDailySummary rows by period index given already-computed periods. */
export function bucketSummariesByPeriod(
  summaries: Array<{ date: Date } & OtterSummaryRow>,
  periods: Period[]
): OtterSummaryRow[][] {
  const bucketed: OtterSummaryRow[][] = periods.map(() => [])
  for (const s of summaries) {
    const t = s.date.getTime()
    const idx = periods.findIndex(
      (p) => t >= p.startDate.getTime() && t <= p.endDate.getTime()
    )
    if (idx === -1) continue
    bucketed[idx].push(s)
  }
  return bucketed
}

