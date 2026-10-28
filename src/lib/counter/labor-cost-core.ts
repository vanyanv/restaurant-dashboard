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
 */

export type LaborSource = "daily" | "positions"

export interface LaborDayCost {
  /** Dollars. Always a number: a missing day has no entry at all. */
  amount: number
  source: LaborSource
}

/**
 * One (store, day) decided. `null` is MISSING.
 *
 * `daily` is `HarriDailyLabor.actualCost` (`null`/`undefined` when the row or
 * the value is absent); `positions` is the day's summed
 * `HarriPositionDaily.totalLabor` (`null`/`undefined` when no row carries a
 * cost).
 */
export function combineLaborDay(
  daily: number | null | undefined,
  positions: number | null | undefined,
): LaborDayCost | null {
  if (typeof daily === "number" && Number.isFinite(daily) && daily > 0) {
    return { amount: daily, source: "daily" }
  }
  if (typeof positions === "number" && Number.isFinite(positions) && positions > 0) {
    return { amount: positions, source: "positions" }
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
  /** Sum of the decided days. */
  total: number
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
    for (const day of input.days) {
      const k = `${storeId}|${day}`
      const decided = combineLaborDay(dailyBy.get(k), posBy.get(k))
      if (decided === null) {
        missingDays.push(day)
        continue
      }
      byDay[day] = decided
      storeTotal += decided.amount
    }
    stores[storeId] = { storeId, byDay, total: storeTotal, days: input.days, missingDays }
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
