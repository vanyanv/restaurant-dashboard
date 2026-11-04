/**
 * The rule behind the one labor-dollar function, with no database in it.
 * `labor-cost.ts` runs the two reads and hands the rows here; this file is
 * what the tests pin.
 *
 * Harri reports a store's labor in two tables that were never reconciled:
 *
 * - `HarriDailyLabor.actualCost` — one row per store and day.
 * - `HarriPositionDaily.totalLabor` — one row per store, day and position.
 *
 * The P&L read the first and the Labor page read the second, so the same week
 * printed two totals. Live data showed the daily table carrying 2 of 7 days
 * for one store-week the position table carried in full, and a pre-open store
 * carrying daily rows of $0. Neither table is right all the time, so the rule
 * is per (store, day):
 *
 * 1. `actualCost` when the row exists and is greater than 0;
 * 2. otherwise the sum of that day's `totalLabor` when position rows exist;
 * 3. otherwise the day is MISSING — not $0. A missing day is a gap in the
 *    sync, and a $0 would read as a day nobody was paid.
 *
 * Neither table's 0 counts as a reading. The position sum must be > 0 too: a
 * store that was paid nobody on an open day is indistinguishable, in this data,
 * from a sync that wrote placeholder rows (SALARIED rows carry $0 and 0
 * seconds), so a TRUE zero-labor day reads as missing. That errs toward saying
 * "labor missing" rather than printing a $0 week.
 *
 * A daily `actualCost` of 0 does not count as a reading: it is what a store
 * with no payroll yet looks like, and it is what the sync writes for days it
 * has not filled in. The position rows are asked before it is believed.
 *
 * ## Employer payroll tax
 *
 * Harri reports WAGES. What the store pays is wages plus the employer's share
 * of payroll tax, so a decided day's `amount` is `wages × (1 + rate)`, where
 * the rate is the store's own `Store.employerPayrollTaxRate` — an owner-edited
 * setting on the store file (default 0.0765, the federal FICA employer share;
 * California UI/ETT are the employer's assigned rate, which the owner adds by
 * raising it). It is applied HERE and nowhere else, so the P&L, prime cost,
 * the Labor page, SPLH and the assistant all carry the same loaded figure.
 * A null (cleared) rate adds nothing. `fixedMonthlyLabor` is not touched: it
 * is a figure the owner enters, taken as the all-in cost.
 */

/** The federal FICA employer share: Social Security 6.2% + Medicare 1.45%. */
export const DEFAULT_EMPLOYER_PAYROLL_TAX_RATE = 0.0765

/**
 * A stored rate as the multiplier's addend. Null, absent, negative or
 * non-finite adds nothing — it never inflates labor on a bad value.
 */
export function payrollTaxRateOf(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0
}

export type LaborSource = "daily" | "positions"

export interface LaborDayCost {
  /**
   * Dollars the store paid: `wages × (1 + payroll tax rate)`. Always a
   * number: a missing day has no entry at all.
   */
  amount: number
  /** Harri's wages for the day, before the employer's payroll tax. */
  wages: number
  source: LaborSource
}

/**
 * One (store, day) decided. `null` is MISSING.
 *
 * `daily` is `HarriDailyLabor.actualCost` (`null`/`undefined` when the row or
 * the value is absent); `positions` is the day's summed
 * `HarriPositionDaily.totalLabor` (`null`/`undefined` when no row carries a
 * cost). `payrollTaxRate` is the store's employer payroll tax (see the module
 * note); the decided wages are loaded with it.
 */
export function combineLaborDay(
  daily: number | null | undefined,
  positions: number | null | undefined,
  payrollTaxRate: number | null | undefined = 0,
): LaborDayCost | null {
  const load = 1 + payrollTaxRateOf(payrollTaxRate)
  if (typeof daily === "number" && Number.isFinite(daily) && daily > 0) {
    return { amount: daily * load, wages: daily, source: "daily" }
  }
  if (typeof positions === "number" && Number.isFinite(positions) && positions > 0) {
    return { amount: positions * load, wages: positions, source: "positions" }
  }
  return null
}

export interface DailyLaborRow {
  storeId: string
  /** `YYYY-MM-DD`. */
  day: string
  actualCost: number | null
}

export interface PositionLaborRow {
  storeId: string
  /** `YYYY-MM-DD`. */
  day: string
  /** The day's `totalLabor` summed over its position rows; `null` when none carries one. */
  totalLabor: number | null
}

export interface StoreLaborCost {
  storeId: string
  /** Decided days only, keyed `YYYY-MM-DD`. */
  byDay: Record<string, LaborDayCost>
  /** Sum of the decided days, payroll tax included. */
  total: number
  /** The employer payroll tax rate applied to this store's wages (0 when none is on file). */
  payrollTaxRate: number
  /** Every day of the range, `YYYY-MM-DD`, for callers that walk it. */
  days: string[]
  /** Days of the range with no reading from either table. */
  missingDays: string[]
}

export interface LaborCost {
  stores: Record<string, StoreLaborCost>
  /** Sum over stores. Equal to the sum of `stores[*].total`. */
  total: number
  /** Store-days with no reading, summed over stores. */
  missingStoreDays: number
}

/** Each calendar day from `start` to `end`, inclusive, as `YYYY-MM-DD` (UTC). */
export function daysBetween(start: Date, end: Date): string[] {
  const out: string[] = []
  const last = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate())
  for (
    let t = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
    t <= last;
    t += 86_400_000
  ) {
    out.push(new Date(t).toISOString().slice(0, 10))
  }
  return out
}

export function foldLaborCost(input: {
  storeIds: string[]
  days: string[]
  daily: DailyLaborRow[]
  positions: PositionLaborRow[]
  /** `Store.employerPayrollTaxRate` by store id. A store not in it adds no tax. */
  payrollTaxRates?: Record<string, number | null | undefined>
}): LaborCost {
  const dailyBy = new Map<string, number | null>()
  for (const r of input.daily) dailyBy.set(`${r.storeId}|${r.day}`, r.actualCost)
  const posBy = new Map<string, number | null>()
  for (const r of input.positions) {
    const k = `${r.storeId}|${r.day}`
    // A store-day arrives as one row, but sum defensively: two rows are one day.
    const prior = posBy.get(k)
    posBy.set(
      k,
      r.totalLabor === null ? (prior ?? null) : (prior ?? 0) + r.totalLabor,
    )
  }

  const stores: Record<string, StoreLaborCost> = {}
  let total = 0
  let missingStoreDays = 0
  for (const storeId of input.storeIds) {
    const byDay: Record<string, LaborDayCost> = {}
    const missingDays: string[] = []
    let storeTotal = 0
    const payrollTaxRate = payrollTaxRateOf(input.payrollTaxRates?.[storeId])
    for (const day of input.days) {
      const k = `${storeId}|${day}`
      const decided = combineLaborDay(dailyBy.get(k), posBy.get(k), payrollTaxRate)
      if (decided === null) {
        missingDays.push(day)
        continue
      }
      byDay[day] = decided
      storeTotal += decided.amount
    }
    stores[storeId] = { storeId, byDay, total: storeTotal, payrollTaxRate, days: input.days, missingDays }
    total += storeTotal
    missingStoreDays += missingDays.length
  }
  return { stores, total, missingStoreDays }
}

/** One store's labor over `[startDay, endDay]` (inclusive `YYYY-MM-DD`). */
export function laborInWindow(
  store: StoreLaborCost | undefined,
  startDay: string,
  endDay: string,
): { amount: number; coveredDays: number; missingDays: number } {
  if (!store) return { amount: 0, coveredDays: 0, missingDays: 0 }
  let amount = 0
  let coveredDays = 0
  for (const [day, v] of Object.entries(store.byDay)) {
    if (day >= startDay && day <= endDay) {
      amount += v.amount
      coveredDays += 1
    }
  }
  const missingDays = store.missingDays.filter((d) => d >= startDay && d <= endDay).length
  return { amount, coveredDays, missingDays }
}

/**
 * Per period, the days this store SOLD on and has no labor reading for — the
 * days its labor line counts as nothing. A day nobody sold on is not a gap.
 *
 * `soldDays` holds `YYYY-MM-DD` keys. Periods are bounded by their UTC
 * calendar days, as `laborByPeriods` bounds them. A store with a fixed monthly
 * labor budget on file has its uncovered days filled from that budget, so the
 * caller passes `fixedLaborOnFile` and gets zeros: those days are estimated,
 * not missing.
 */
export function soldDaysWithoutLabor(
  store: StoreLaborCost | undefined,
  soldDays: ReadonlySet<string>,
  periods: Array<{ startDate: Date; endDate: Date }>,
  fixedLaborOnFile = false,
): number[] {
  return periods.map((p) => {
    if (fixedLaborOnFile) return 0
    const start = p.startDate.toISOString().slice(0, 10)
    const end = p.endDate.toISOString().slice(0, 10)
    let n = 0
    for (const day of soldDays) {
      if (day < start || day > end) continue
      if (!store || !store.byDay[day]) n += 1
    }
    return n
  })
}

/**
 * "A fixed monthly labor budget is on file." `0` is how the store file saves
 * a budget nobody entered, so it reads as not set, same as `null`.
 */
export function hasFixedLabor(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0
}

/**
 * One store's labor per period, in the shape `computeStorePnL` takes as
 * `harriLaborByPeriod`. Periods are bounded by their UTC calendar days.
 */
export function laborByPeriods(
  store: StoreLaborCost | undefined,
  periods: Array<{ startDate: Date; endDate: Date }>,
): Array<{ actualUsd: number; coveredDays: number; missingDays: number }> {
  return periods.map((p) => {
    const w = laborInWindow(
      store,
      p.startDate.toISOString().slice(0, 10),
      p.endDate.toISOString().slice(0, 10),
    )
    return { actualUsd: w.amount, coveredDays: w.coveredDays, missingDays: w.missingDays }
  })
}

/**
 * Per day, the stores with no labor reading. Which of them SOLD that day is
 * the caller's to say (sales come from the statement, not from Harri):
 * `missingLaborByDay` below joins the two.
 */
export function missingStoresByDay(cost: LaborCost): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const store of Object.values(cost.stores)) {
    for (const day of store.missingDays) (out[day] ??= []).push(store.storeId)
  }
  return out
}

/**
 * The store-days that sold and have no labor reading, per day: how many, and
 * the Net Sales on them. A day nobody sold on is not a gap in labor, so it is
 * not counted; and the sales on a counted store-day are what a labor % or
 * SPLH must leave out of its denominator, because no labor is on its other side.
 */
export function missingLaborByDay(
  missingStores: Record<string, string[]>,
  salesByStoreDay: Map<string, Map<string, number>>,
): Record<string, { storeDays: number; sales: number }> {
  const out: Record<string, { storeDays: number; sales: number }> = {}
  for (const [day, storeIds] of Object.entries(missingStores)) {
    for (const storeId of storeIds) {
      const sales = salesByStoreDay.get(storeId)?.get(day) ?? 0
      if (!(sales > 0)) continue
      const cur = (out[day] ??= { storeDays: 0, sales: 0 })
      cur.storeDays += 1
      cur.sales += sales
    }
  }
  return out
}
