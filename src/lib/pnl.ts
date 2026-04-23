import {
  addDays,
  differenceInCalendarDays,
  endOfMonth,
  endOfWeek,
  format,
  isAfter,
  isBefore,
  startOfMonth,
  startOfWeek,
} from "date-fns"

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
}

// ─── GL row metadata ───

export const UBER_ROW_INDEX = 2
export const DOORDASH_ROW_INDEX = 3

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
  { code: "4100", label: "SALES TAXES" },
  { code: "4110", label: "DISCOUNTS (GUEST)" },
] as const

export const TOTAL_SALES_CODE = "TOTAL_SALES"
export const UBER_COMMISSION_CODE = "COM_UBER"
export const DOORDASH_COMMISSION_CODE = "COM_DD"
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
    let weekStart = startOfWeek(rangeStart, { weekStartsOn: 0 }) // Sunday
    while (!isAfter(weekStart, rangeEnd)) {
      const weekEnd = endOfWeek(weekStart, { weekStartsOn: 0 })
      const bucketStart = isBefore(weekStart, rangeStart) ? rangeStart : weekStart
      const bucketEnd = isAfter(weekEnd, rangeEnd) ? rangeEnd : weekEnd
      const days = differenceInCalendarDays(bucketEnd, bucketStart) + 1
      const isPartial = days < 7
      periods.push({
        label: isPartial
          ? `Week of ${format(weekStart, "MMM d")} (${days}d)`
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

function startOfDay(d: Date): Date {
  const n = new Date(d)
  n.setHours(0, 0, 0, 0)
  return n
}

// ─── Fixed-cost conversion ───

const DAYS_PER_MONTH = 365.25 / 12 // ≈ 30.4375

/**
 * Convert a monthly fixed-cost figure to the amount applicable to a period of `days` days.
 * Uses a 30.4375-day month so weekly (7d) ≈ monthly/4.348 and full-month values match exactly.
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
}

const FP_PLATFORMS = new Set(["css-pos", "bnm-web"])

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

/**
 * Map a bucket of OtterDailySummary rows to the 14 GL sales lines.
 * Returns an array of length GL_ROWS.length, in the same order.
 */
export function salesRowValues(rows: OtterSummaryRow[]): number[] {
  const creditCards = sumBy(
    rows,
    (r) => r.fpGrossSales,
    (r) => FP_PLATFORMS.has(r.platform) && r.paymentMethod === "CARD"
  )
  const cash = sumBy(
    rows,
    (r) => r.fpGrossSales,
    (r) => FP_PLATFORMS.has(r.platform) && r.paymentMethod === "CASH"
  )
  const uber = sumBy(rows, (r) => r.tpGrossSales, (r) => r.platform === "ubereats")
  const doordash = sumBy(rows, (r) => r.tpGrossSales, (r) => r.platform === "doordash")
  const grubhub = sumBy(rows, (r) => r.tpGrossSales, (r) => r.platform === "grubhub")
  const chownow = sumBy(rows, (r) => r.tpGrossSales, (r) => r.platform === "chownow")
  const caviar = sumBy(rows, (r) => r.tpGrossSales, (r) => r.platform === "caviar")

  const serviceCharge =
    sumBy(rows, (r) => r.fpServiceCharges) + sumBy(rows, (r) => r.tpServiceCharges)
  const tax = -(sumBy(rows, (r) => r.fpTaxCollected) + sumBy(rows, (r) => r.tpTaxCollected))
  // fp/tpDiscounts come back signed negative from Otter — do not negate.
  const discounts = sumBy(rows, (r) => r.fpDiscounts) + sumBy(rows, (r) => r.tpDiscounts)

  return [
    creditCards, // 4010
    cash,        // 4011
    uber,        // 4012
    doordash,    // 4013
    grubhub,     // 4014
    chownow,     // 4015
    caviar,      // 4015C
    0,           // 4016 EZ Cater (no source)
    0,           // 4017 Fooda (no source)
    0,           // 4018 Otter Online (no source)
    0,           // 4018P Otter Prepaid (no source)
    0,           // 4020 Beverage (not separately tracked)
    serviceCharge, // 4040
    tax,         // 4100
    discounts,   // 4110
  ]
}

/** Compute % of Total Sales for each value. Returns 0 when total is 0. */
export function percents(values: number[], total: number): number[] {
  if (total === 0) return values.map(() => 0)
  return values.map((v) => v / total)
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
  fixedMonthlyLabor: number | null
  fixedMonthlyRent: number | null
  fixedMonthlyTowels: number | null
  fixedMonthlyCleaning: number | null
  uberCommissionRate: number
  doordashCommissionRate: number
}

export interface ComputedPnL {
  rows: PnLRow[]
  perPeriodSalesValues: number[][]
  totalSales: number[]
  uberCommission: number[] // already negative
  doordashCommission: number[] // already negative
  netAfterCommissions: number[]
  cogsValues: number[] // positive magnitude (may be 0s if no recipes)
  grossProfit: number[]
  laborValues: number[] // positive magnitude
  rentValues: number[] // positive magnitude
  towelsValues: number[] // positive magnitude
  cleaningValues: number[] // positive magnitude
  bottomLine: number[]
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
}): ComputedPnL {
  const { bucketed, periods, store, cogsValues } = input

  const perPeriodSalesValues = bucketed.map((rows) => salesRowValues(rows))
  const totalSales = perPeriodSalesValues.map((vals) => vals.reduce((a, b) => a + b, 0))

  const rows: PnLRow[] = GL_ROWS.map((meta, rowIdx) => {
    const values = perPeriodSalesValues.map((v) => v[rowIdx])
    return {
      code: meta.code,
      label: meta.label,
      values,
      percents: values.map((v, i) => (totalSales[i] === 0 ? 0 : v / totalSales[i])),
    }
  })

  rows.push({
    code: TOTAL_SALES_CODE,
    label: "Total Sales",
    values: totalSales,
    percents: totalSales.map(() => 1),
    isSubtotal: true,
  })

  const uberGross = perPeriodSalesValues.map((v) => v[UBER_ROW_INDEX])
  const doordashGross = perPeriodSalesValues.map((v) => v[DOORDASH_ROW_INDEX])
  const uberCommission = uberGross.map((g) => -(g * store.uberCommissionRate))
  const doordashCommission = doordashGross.map((g) => -(g * store.doordashCommissionRate))

  rows.push({
    code: UBER_COMMISSION_CODE,
    label: `Uber Commission (${(store.uberCommissionRate * 100).toFixed(0)}%)`,
    values: uberCommission,
    percents: uberCommission.map((v, i) => (totalSales[i] === 0 ? 0 : v / totalSales[i])),
    isFixed: true,
  })
  rows.push({
    code: DOORDASH_COMMISSION_CODE,
    label: `DoorDash Commission (${(store.doordashCommissionRate * 100).toFixed(0)}%)`,
    values: doordashCommission,
    percents: doordashCommission.map((v, i) => (totalSales[i] === 0 ? 0 : v / totalSales[i])),
    isFixed: true,
  })

  const netAfterCommissions = totalSales.map(
    (ts, i) => ts + uberCommission[i] + doordashCommission[i]
  )
  rows.push({
    code: NET_AFTER_COMMISSIONS_CODE,
    label: "Net Sales After Commissions",
    values: netAfterCommissions,
    percents: netAfterCommissions.map((v, i) => (totalSales[i] === 0 ? 0 : v / totalSales[i])),
    isSubtotal: true,
  })

  const cogs = cogsValues ?? periods.map(() => 0)
  const grossProfit = netAfterCommissions.map((n, i) => n - cogs[i])

  if (cogsValues) {
    rows.push({
      code: COGS_CODE,
      label: "Cost of Goods Sold",
      values: cogs.map((v) => -v),
      percents: cogs.map((v, i) => (totalSales[i] === 0 ? 0 : -v / totalSales[i])),
    })
    rows.push({
      code: GROSS_PROFIT_CODE,
      label: "Gross Profit",
      values: grossProfit,
      percents: grossProfit.map((v, i) => (totalSales[i] === 0 ? 0 : v / totalSales[i])),
      isSubtotal: true,
    })
  }

  const laborValues = periods.map(
    (p) => monthlyCostForDays(store.fixedMonthlyLabor, p.days) ?? 0
  )
  const rentValues = periods.map(
    (p) => monthlyCostForDays(store.fixedMonthlyRent, p.days) ?? 0
  )
  const cleaningValues = periods.map(
    (p) => monthlyCostForDays(store.fixedMonthlyCleaning, p.days) ?? 0
  )
  const towelsValues = periods.map(
    (p) => monthlyCostForDays(store.fixedMonthlyTowels, p.days) ?? 0
  )
  const laborUnknown = periods.map(() => store.fixedMonthlyLabor == null)
  const rentUnknown = periods.map(() => store.fixedMonthlyRent == null)
  const cleaningUnknown = periods.map(() => store.fixedMonthlyCleaning == null)
  const towelsUnknown = periods.map(() => store.fixedMonthlyTowels == null)

  rows.push({
    code: LABOR_CODE,
    label: "Labor (fixed)",
    values: laborValues.map((v) => -v),
    percents: laborValues.map((v, i) => (totalSales[i] === 0 ? 0 : -v / totalSales[i])),
    isFixed: true,
    isUnknown: laborUnknown,
  })
  rows.push({
    code: RENT_CODE,
    label: "Rent (fixed)",
    values: rentValues.map((v) => -v),
    percents: rentValues.map((v, i) => (totalSales[i] === 0 ? 0 : -v / totalSales[i])),
    isFixed: true,
    isUnknown: rentUnknown,
  })
  rows.push({
    code: CLEANING_CODE,
    label: "Store Cleaning (fixed)",
    values: cleaningValues.map((v) => -v),
    percents: cleaningValues.map((v, i) => (totalSales[i] === 0 ? 0 : -v / totalSales[i])),
    isFixed: true,
    isUnknown: cleaningUnknown,
  })
  rows.push({
    code: TOWELS_CODE,
    label: "Towels (fixed)",
    values: towelsValues.map((v) => -v),
    percents: towelsValues.map((v, i) => (totalSales[i] === 0 ? 0 : -v / totalSales[i])),
    isFixed: true,
    isUnknown: towelsUnknown,
  })

  const bottomLine = netAfterCommissions.map(
    (n, i) =>
      n - cogs[i] - laborValues[i] - rentValues[i] - cleaningValues[i] - towelsValues[i]
  )
  rows.push({
    code: AFTER_LABOR_RENT_CODE,
    label: "Net After Commissions & Fixed Costs",
    values: bottomLine,
    percents: bottomLine.map((v, i) => (totalSales[i] === 0 ? 0 : v / totalSales[i])),
    isSubtotal: true,
  })

  return {
    rows,
    perPeriodSalesValues,
    totalSales,
    uberCommission,
    doordashCommission,
    netAfterCommissions,
    cogsValues: cogs,
    grossProfit,
    laborValues,
    rentValues,
    towelsValues,
    cleaningValues,
    bottomLine,
  }
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

