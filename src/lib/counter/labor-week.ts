import { addDays } from "date-fns"
import { prisma } from "@/lib/prisma"
import { getScopedStores } from "@/lib/account-stores"
import { cached, stableKey } from "@/lib/cache/cached"
import { otterRangeTags, rangeTtl } from "@/lib/cache/range"
import { loadLaborCost } from "@/lib/counter/labor-cost"
import { missingLaborByDay, missingStoresByDay } from "@/lib/counter/labor-cost-core"
import { businessCalendarDate } from "@/lib/counter/business-date"
import {
  dayCount,
  isoDay,
  monthDay,
  toQueryBounds,
  trailingWeeks,
  type DateRange,
} from "@/lib/counter/date-range"

/**
 * The labour week: hours, cost, sales-per-labour-hour and labour percent,
 * the role split, and a twelve-week trend.
 *
 * ## One sales figure, one labor-dollar function
 *
 * - **`laborPct` and `splh` are both taken on TOTAL SALES** — the P&L's Net
 *   Sales (`TOTAL_SALES_CODE` on the statement). That figure is NOT queried
 *   here: `loadLaborWeek` takes it in as `salesByDay`, off the daily statement
 *   the page already loaded, and `loadLaborTrend` takes it per week. A loader
 *   that queried its own sales would be a second place the number could drift
 *   from the P&L's. SPLH used to divide `OtterHourlySummary.netSales` (a
 *   different "net sales", ~6% higher at Hollywood); that made the page print
 *   two, and is gone.
 * - **Labor DOLLARS come from `loadLaborCost`** (`labor-cost.ts`), the same
 *   rule the P&L reads: `HarriDailyLabor.actualCost` when it is a real
 *   reading, else the day's `HarriPositionDaily.totalLabor`, else the day is
 *   MISSING (`LaborDay.costMissing`) — not $0. Hours, the schedule gap and the
 *   role split stay on `HarriPositionDaily` / `HarriShift`: they are not
 *   dollars of the day. So the role split's costs can differ from the day
 *   total on a day the daily table won; the headline never uses them.
 *
 * ## Scoping
 *
 * Both loaders resolve stores through `accountId` FIRST, exactly as
 * `loadChannelMix` and `loadServiceProfile` do: `storeId: null` has to mean
 * "every active store on this account", not "every store in the database".
 * This module deliberately does not import `@/lib/auth` — that pulls in
 * `@/lib/prisma` at MODULE LOAD, which throws without `DATABASE_URL` and
 * takes every importer down with it, tests included. The page already has an
 * `accountId` from its own session lookup.
 *
 * ## Nulls, three times over
 *
 * - `splh` is `null` with no hours (dividing by zero hours is not "$0 per
 *   hour") AND with no platform sales data — never `0`.
 * - `scheduledHours` is `null` when `HarriShift` has NO row for a day, not
 *   when its rows sum to zero. No published schedule is not a schedule of
 *   nothing.
 * - `laborPct` is `null` with no Total Sales for the day — never `0`.
 * - A SALARIED position carrying `$0` and `0h` (Operator, in the measured
 *   data) still appears in `laborRole`'s output with `share: 0`. The salaried
 *   line being empty is an answer; dropping the row would say nothing at all.
 *
 * `HarriShift`'s scheduled-hours sum excludes `isVirtual` rows (an unfilled
 * slot the manager left on the grid), matching the existing "scheduled
 * hours" reading in `labor-productivity-actions.ts` — the same word means
 * the same thing on both labor surfaces.
 */

export interface LaborDay {
  /** `YYYY-MM-DD`. */
  key: string
  /** "Wed Aug 26". */
  label: string
  /** Hours actually worked, from `HarriPositionDaily.actualSeconds`. */
  actualHours: number
  /** Hours published, from `HarriShift.minutes`. `null` when no schedule was published. */
  scheduledHours: number | null
  cost: number
  /**
   * Store-days that SOLD on this day and have no labor reading in either Harri
   * table (`loadLaborCost`'s MISSING). `cost` leaves them out — they were not
   * free, they were not synced — and so do `laborPct` and `splh`.
   */
  missingStoreDays: number
  /** `missingStoreDays > 0`. */
  costMissing: boolean
  /**
   * The day's Total Sales less the sales on its missing store-days: what
   * `laborPct` and `splh` divide by, so neither has a numerator short of a
   * store the denominator still counts. `null` with no sales figure.
   */
  ratedSales: number | null
  /** Rated sales over hours worked. `null` with no hours or no sales — never `0`. */
  splh: number | null
  /** This day's labour over this day's Total Sales, 0..100. `null` with no sales. */
  laborPct: number | null
  /**
   * The Total Sales this day's `laborPct` was taken on, kept rather than
   * recoverable.
   *
   * `laborWeek` used to rebuild the week's denominator by INVERTING each day's
   * percentage — `cost / (laborPct / 100)` — and that is exact only while
   * every day has labour on it. A day that sold and had nobody clocked in has
   * `cost` 0, so its `laborPct` is 0 rather than null; it survives the
   * `!== null` filter, `0 / (0 / 100)` is NaN, and one such day turns the
   * whole week's percentage into NaN, which `pct()` renders as an em dash.
   * That is every current day, all day, until the first clock-in syncs — and
   * it is what put "Hourly labor —" on the live page directly above a caption
   * reading "$7,258 of $41,006 Total Sales".
   *
   * Carrying the number is also simply the truthful thing: it is an input, and
   * reconstructing an input from an output it was rounded into is a way to be
   * wrong for free.
   */
  totalSales: number | null
  /**
   * Hours worked against hours published over ONLY this day's store-days that
   * carry both. A store-day with a schedule and no hours from Harri yet is left
   * out of both sides, so a sync that has not landed cannot read as the store
   * working under its schedule. `null` when no store-day has both.
   */
  compare: ScheduleCompare | null
  /** Store-days with a published schedule and no hours worked from Harri yet. */
  awaitingStoreDays: number
}

/** Hours worked and hours published over the same store-days. */
export interface ScheduleCompare {
  actualHours: number
  scheduledHours: number
}

export interface LaborWeek {
  days: LaborDay[]
  actualHours: number
  scheduledHours: number | null
  cost: number
  /** Store-days that sold and have no labor reading — the week's labor total is short by them. */
  missingStoreDays: number
  /** `cost / actualHours`. The rate the leak ledger costs its hours at. */
  blendedRate: number | null
  splh: number | null
  /** Over TOTAL SALES (L-R2). */
  laborPct: number | null
  overtimeCost: number
  /**
   * The schedule reading: `LaborDay.compare` summed. THIS, not
   * `actualHours - scheduledHours`, is what any "over / under the schedule"
   * sentence reads. The gross pair also counts days Harri has not sent hours
   * for, and that read a missing sync as 128 hours "under the schedule".
   */
  compare: ScheduleCompare | null
  /** Labels of days with at least one store-day still waiting on Harri's hours. */
  awaitingDays: string[]
  awaitingStoreDays: number
  /**
   * Labels of days in the range Harri has not finalised yet (see
   * `provisionalWindow`). Their hours and costs can still move.
   */
  provisionalDays: string[]
}

export interface LaborRole {
  position: string
  payType: "HOURLY" | "SALARIED"
  hours: number
  cost: number
  /** Share of the range's labour cost, 0..100. */
  share: number
}

export interface LaborTrendWeek {
  /** Monday of the week, `YYYY-MM-DD`. */
  key: string
  label: string
  cost: number
  hours: number
  /**
   * Over TOTAL SALES — the identical denominator `LaborWeek.laborPct` uses,
   * fed in by the adapter as this week's slice of the SAME statement
   * construct the headline reads (L-R2, task 4b). `null` with no Total Sales
   * for the week.
   */
  laborPct: number | null
  /** Over the same TOTAL SALES as `laborPct`. `null` with no sales or no hours. */
  splh: number | null
  /** Store-days that sold with no labor reading inside the week. */
  missingStoreDays: number
  /** Fewer days than a full week fell inside the data (L-R11). */
  isPartial: boolean
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0)
}

/**
 * Labour cost as a percent of a sales figure, 0..100 — the ONE expression
 * `laborDay`, `laborWeek` and `laborTrendWeek` all call for `laborPct`, so the
 * headline and the trend can never diverge by computing this ratio two ways
 * (task 4b's whole point: they did, by 5 points, before this existed).
 *
 * `null` when the sales figure is unknown or not positive — a percent of zero
 * or negative sales is not a labour percentage, it is a division nobody asked
 * for, and `<= 0` (not `=== 0`) keeps a range of pure refunds from reading as
 * a triumph, the same guard `statement.ts`'s `marginPct` uses.
 */
/**
 * Labour over sales, or `null` when there is no reading to state.
 *
 * THE GUARD REFUSES NON-FINITE INPUTS, and that is the whole point of this
 * docblock. It used to read `sales === null || sales <= 0`, which is exactly
 * the shape that let a NaN through: `NaN === null` is false and `NaN <= 0` is
 * false, so a not-a-number denominator sailed past both tests, divided, and
 * came out the other side as NaN. `pct()` renders any non-finite number as an
 * em dash, so the Labor page printed a dash where 17.7% belonged and no
 * surface in between said anything was wrong.
 *
 * The caller that produced the NaN has been fixed — `laborWeek` sums the real
 * Total Sales now instead of reconstructing it by inverting each day's own
 * percentage. This is the other half: null means "no reading", and a caller
 * that hands this arithmetic it cannot do should be told that rather than
 * having it rendered as absence three surfaces away.
 */
function pctOfSales(cost: number, sales: number | null): number | null {
  if (sales === null || !Number.isFinite(sales) || sales <= 0) return null
  if (!Number.isFinite(cost)) return null
  return (cost / sales) * 100
}

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]

/** "Wed Aug 26", off a LOCAL midnight `Date` (this module's `DateRange` contract). */
function dayLabel(d: Date): string {
  return `${WEEKDAY_SHORT[d.getDay()]} ${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`
}

/**
 * A calendar day off a `@db.Date` column, read with UTC getters.
 *
 * `HarriPositionDaily.date`, `HarriShift.date` and `OtterHourlySummary.date`
 * are all stored at UTC midnight for the calendar day they name — reading
 * them back with local getters would shift the day in any non-UTC zone. Same
 * function as `service-profile.ts`'s `dateKey` and `splh-actions.ts`'s
 * `calendarDay`, kept local here because it is a three-line read, not a
 * shared abstraction worth a fourth copy of an import.
 */
function dbDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * One day's labour, from raw hours/cost and the two sales figures described
 * in the module comment.
 */
export function laborDay(input: {
  key: string
  label: string
  actualSeconds: number
  /** `null` when `HarriShift` published no shift at all for this day. */
  scheduledMinutes: number | null
  /**
   * The day's store-days with BOTH hours worked and a published schedule,
   * summed. Left out (single-store callers and tests), it is the day's own
   * totals when the day has both, else nothing.
   */
  matched?: { seconds: number; scheduledMinutes: number } | null
  /** Store-days with a schedule and no hours yet. Left out, derived from the day's totals. */
  awaitingStoreDays?: number
  cost: number
  /** Store-days that sold with no labor reading (see `LaborDay.missingStoreDays`). */
  missingStoreDays?: number
  /** Net Sales on those store-days; left out of the ratios' denominator. */
  missingSales?: number
  /** Off the statement's Total Sales row — what the page prints as the day's sales. */
  totalSales: number | null
}): LaborDay {
  const actualHours = input.actualSeconds / 3600
  const scheduledHours =
    input.scheduledMinutes === null ? null : input.scheduledMinutes / 60
  const missingStoreDays = input.missingStoreDays ?? 0
  const ratedSales =
    input.totalSales === null || !Number.isFinite(input.totalSales)
      ? input.totalSales
      : Math.max(0, input.totalSales - (input.missingSales ?? 0))
  const splh =
    ratedSales === null || !Number.isFinite(ratedSales) || actualHours === 0
      ? null
      : ratedSales / actualHours
  // A day whose labor is missing has a rated denominator of 0 (single store),
  // so its percentage is "no reading", never 0.0%.
  const laborPct = pctOfSales(input.cost, ratedSales)

  const matched =
    input.matched !== undefined
      ? input.matched
      : input.scheduledMinutes !== null && input.actualSeconds > 0
        ? { seconds: input.actualSeconds, scheduledMinutes: input.scheduledMinutes }
        : null
  const compare =
    matched === null || matched.seconds <= 0
      ? null
      : { actualHours: matched.seconds / 3600, scheduledHours: matched.scheduledMinutes / 60 }
  const awaitingStoreDays =
    input.awaitingStoreDays ??
    (input.scheduledMinutes !== null && input.scheduledMinutes > 0 && input.actualSeconds === 0 ? 1 : 0)

  return {
    key: input.key,
    label: input.label,
    actualHours,
    scheduledHours,
    cost: input.cost,
    missingStoreDays,
    costMissing: missingStoreDays > 0,
    ratedSales,
    splh,
    laborPct,
    totalSales: input.totalSales,
    compare,
    awaitingStoreDays,
  }
}

/**
 * The week, rolled up from its days.
 *
 * `splh` and `laborPct` do not take a second sales input — they reconstruct
 * each day's sales by inverting that day's OWN `splh`/`laborPct`
 * (`platformSales = splh * actualHours`, `totalSales = cost / (laborPct /
 * 100)`), which is exact to float precision because `laborDay` performed
 * that exact division once, right there, and this is its algebraic inverse.
 * A second sales figure threaded all the way to this function would be a
 * second place either ratio could disagree with the day rows sitting next to
 * it — the same defect this whole module exists to close, one layer up.
 *
 * Both reconstructions are PAIRED: a day with no `splh` (no hours, or no
 * platform sales) is excluded from both the sales side AND the hours side of
 * that specific ratio, so an unknown day never dilutes a known day's rate.
 * `actualHours`, `scheduledHours` and `cost` are unconditional sums — the
 * week's real hours and real spend do not become smaller because one day's
 * sales went unrecorded.
 */
export function laborWeek(
  days: LaborDay[],
  overtimeCost: number,
  opts: {
    /** `provisionalWindow(today)`: days from `from` up to `today` are provisional. */
    provisional?: { from: string; today: string }
  } = {},
): LaborWeek {
  const actualHours = sum(days.map((d) => d.actualHours))
  const cost = sum(days.map((d) => d.cost))
  const blendedRate = actualHours > 0 ? cost / actualHours : null

  const scheduledKnown = days.filter(
    (d): d is LaborDay & { scheduledHours: number } => d.scheduledHours !== null,
  )
  const scheduledHours =
    scheduledKnown.length > 0
      ? sum(scheduledKnown.map((d) => d.scheduledHours))
      : null

  const splhKnown = days.filter((d) => d.splh !== null)
  const splhHours = sum(splhKnown.map((d) => d.actualHours))
  const splhSales = sum(splhKnown.map((d) => d.ratedSales as number))
  const splh = splhHours > 0 ? splhSales / splhHours : null

  /*
   * SUMMED, not reconstructed. See `LaborDay.totalSales` for what inverting
   * each day's percentage cost: a single day with sales and no labour made the
   * week's figure NaN and the page printed an em dash where 17.7% belonged.
   *
   * Days with no sales figure at all are still excluded — a null denominator
   * is not a zero one — but a day that sold and had nobody clocked in now
   * contributes its sales, which is exactly what the P&L's own denominator
   * does with it.
   */
  // A day whose sales figure is not a number contributes nothing rather than
  // making the week's denominator NaN — one bad row must not take the other
  // six with it, which is the failure this whole block exists to prevent.
  const salesKnown = days.filter(
    (d) => d.ratedSales !== null && Number.isFinite(d.ratedSales),
  )
  const totalSales =
    salesKnown.length === 0 ? null : sum(salesKnown.map((d) => d.ratedSales as number))
  const laborPct = pctOfSales(cost, totalSales)

  const missingStoreDays = sum(days.map((d) => d.missingStoreDays))

  const compared = days.filter((d) => d.compare !== null)
  const compare =
    compared.length === 0
      ? null
      : {
          actualHours: sum(compared.map((d) => d.compare!.actualHours)),
          scheduledHours: sum(compared.map((d) => d.compare!.scheduledHours)),
        }
  const awaiting = days.filter((d) => d.awaitingStoreDays > 0)
  const p = opts.provisional
  const provisionalDays =
    p === undefined ? [] : days.filter((d) => d.key >= p.from && d.key <= p.today).map((d) => d.label)

  return {
    days,
    actualHours,
    scheduledHours,
    cost,
    missingStoreDays,
    blendedRate,
    splh,
    laborPct,
    overtimeCost,
    compare,
    awaitingDays: awaiting.map((d) => d.label),
    awaitingStoreDays: sum(awaiting.map((d) => d.awaitingStoreDays)),
    provisionalDays,
  }
}

/**
 * Harri's provisional window, for a page rendered on `today`.
 *
 * Harri finalises a day about two days after it (D+2), and the cron re-syncs
 * the last three. So today and yesterday (Los Angeles business days) are not
 * final: hours can still be added and costs can still move. `from` is
 * yesterday's key and `today` today's, so a range that ends earlier names
 * nothing.
 */
export function provisionalWindow(today: Date): { from: string; today: string } {
  const d = businessCalendarDate(today)
  return { from: isoDay(addDays(d, -1)), today: isoDay(d) }
}

/** Below this share of sales, a store's labor is more likely missing than lean. */
export const LABOR_INCOMPLETE_PCT = 10

/** One store's labor over its own rated sales for the range. */
export interface LaborStoreShare {
  storeId: string
  name: string
  cost: number
  /** Net Sales on the store's days that HAVE a labor reading. */
  ratedSales: number
  /** `null` with no rated sales. */
  laborPct: number | null
}

/**
 * The stores whose labor reads below `LABOR_INCOMPLETE_PCT` of their sales.
 *
 * A restaurant does not run on 2% labor. A share that low on a store that
 * sold means hours or wages are missing from what Harri sent (Glendale read
 * 2.2%), so the page says "looks incomplete" instead of printing it as fact.
 */
export function incompleteLaborStores(shares: LaborStoreShare[]): LaborStoreShare[] {
  return shares.filter(
    (s) => s.ratedSales > 0 && s.laborPct !== null && s.laborPct < LABOR_INCOMPLETE_PCT,
  )
}

/**
 * Each store's share, off the per-store labor cost and the per-store sales.
 * A store-day with no labor reading is left out of that store's sales, the
 * same rule `laborDay`'s rated sales applies.
 */
export function laborStoreShares(
  stores: Array<{ id: string; name: string }>,
  costByStore: Record<string, number>,
  missingByDay: Record<string, string[]>,
  salesByStoreDay: Map<string, Map<string, number>>,
): LaborStoreShare[] {
  return stores.map((s) => {
    let ratedSales = 0
    for (const [day, sales] of salesByStoreDay.get(s.id) ?? []) {
      if (!Number.isFinite(sales)) continue
      if (missingByDay[day]?.includes(s.id)) continue
      ratedSales += sales
    }
    const cost = costByStore[s.id] ?? 0
    return { storeId: s.id, name: s.name, cost, ratedSales, laborPct: pctOfSales(cost, ratedSales) }
  })
}

/**
 * The role split, off (position, payType) rows already summed over the
 * range.
 *
 * Never filters a zero-cost row out — a SALARIED position with `$0` and `0h`
 * (Operator, measured) gets `share: 0` rather than being dropped. Not in the
 * brief's export list, but named directly by its own assertion ("`laborRole`
 * shares sum to 100…") — pulled out as its own pure function, alongside
 * `laborDay`/`laborWeek`, so that assertion is testable without mocking
 * Prisma.
 */
export function laborRole(
  rows: Array<{
    position: string
    payType: "HOURLY" | "SALARIED"
    hours: number
    cost: number
  }>,
): LaborRole[] {
  const totalCost = sum(rows.map((r) => r.cost))
  return rows.map((r) => ({
    position: r.position,
    payType: r.payType,
    hours: r.hours,
    cost: r.cost,
    share: totalCost > 0 ? (r.cost / totalCost) * 100 : 0,
  }))
}

interface TrendDayInput {
  cost: number
  hours: number
  /** The day's Total Sales; `null` when the statement has no figure for it. */
  sales: number | null
  /** Store-days that sold with no labor reading, and the sales on them. */
  missingStoreDays: number
  missingSales: number
}

/**
 * One trend-chart bar, off a Monday-start week and its days.
 *
 * Pulled out as its own pure function — not in the brief's export list —
 * because `loadLaborTrend`'s own assertion ("marks the newest week
 * `isPartial: true`") is otherwise untestable under this task's rule that
 * loaders are not unit-tested and Prisma is not mocked. `isPartial` is
 * carried straight through from the caller (`trailingWeeks`'s own
 * `.partial`), never re-derived here — L-R11 is `trailingWeeks`'s test to
 * pass, not a second one written against its answer.
 *
 * `totalSales` is this week's OWN slice of Total Sales, fed in by the caller
 * (task 4b) — never derived from `days`, because Total Sales is not on
 * `TrendDayInput` and has no business being reconstructed from platform
 * sales. `laborPct` and `LaborWeek.laborPct` now call the identical
 * `pctOfSales`, so they cannot compute this ratio two ways again.
 */
export function laborTrendWeek(
  weekStart: Date,
  isPartial: boolean,
  days: TrendDayInput[],
): LaborTrendWeek {
  const cost = sum(days.map((d) => d.cost))
  const hours = sum(days.map((d) => d.hours))

  // Both ratios divide RATED sales — the day's sales less the store-days with
  // no labor reading — so a missing day cannot dilute them. SPLH pairs a day's
  // sales with that day's hours, as `laborWeek` does: sales on a day with no
  // hours are not a rate.
  const rated = days.map((d) =>
    d.sales === null || !Number.isFinite(d.sales) ? null : Math.max(0, d.sales - d.missingSales),
  )
  const known = rated.filter((r): r is number => r !== null)
  const ratedTotal = known.length === 0 ? null : sum(known)
  const paired = days.filter((d, i) => rated[i] !== null && d.hours > 0)
  const pairedHours = sum(paired.map((d) => d.hours))
  const pairedSales = sum(paired.map((d) => rated[days.indexOf(d)] as number))

  return {
    key: isoDay(weekStart),
    label: monthDay(weekStart),
    cost,
    hours,
    laborPct: pctOfSales(cost, ratedTotal),
    splh: pairedHours > 0 ? pairedSales / pairedHours : null,
    missingStoreDays: sum(days.map((d) => d.missingStoreDays)),
    isPartial,
  }
}

/**
 * The range's labour, queried.
 *
 * ONE query against `HarriPositionDaily` answers both the day list and the
 * role split — the same rows fold both ways, so a role total and a day total
 * built from them can never disagree about what happened on a given day.
 * `HarriShift` (schedule) and `OtterHourlySummary` (SPLH's sales) are each a
 * second query because each is answering a question the position-daily rows
 * do not carry the answer to.
 */
export async function loadLaborWeek(input: {
  range: DateRange
  storeId: string | null
  accountId: string
  /**
   * Per-day Total Sales, keyed `YYYY-MM-DD`, off the statement the page already
   * loaded. May be a promise: the fold below does not need it, so a page can
   * start this load before its statement has arrived and the labour read runs
   * alongside the P&L rollup instead of after it.
   */
  salesByDay: Map<string, number> | Promise<Map<string, number>>
  /** The same Net Sales per store and day, off the same statement — see `salesByStoreDayOf`. */
  salesByStoreDay: Map<string, Map<string, number>> | Promise<Map<string, Map<string, number>>>
}): Promise<{
  days: LaborDay[]
  roles: LaborRole[]
  overtimeCost: number
  storeShares: LaborStoreShare[]
}> {
  const { range, storeId, accountId } = input
  const { startDate, endDate } = toQueryBounds(range)

  const stores = await getScopedStores(accountId, storeId ?? null)
  // A storeId that is not on this account resolves to no stores, not to the
  // whole account (same rule as `loadChannelMix`/`loadServiceProfile`).
  if (stores.length === 0) return { days: [], roles: [], overtimeCost: 0, storeShares: [] }
  const storeIds = stores.map((s) => s.id)

  // The FOLD is cached, never the rows — every row here carries a `Date` that
  // `dbDay` reads with `toISOString()`, which a string back from Redis lacks.
  // `salesByDay` stays OUTSIDE: it is the statement's figure, already cached
  // under its own key, and it only enters at `laborDay` below. Folding it in
  // would make this key move with the statement instead of with labour.
  const fold = await cached(
    `counter:laborweek4:${stableKey({ a: accountId, ids: [...storeIds].sort(), from: startDate, to: endDate })}`,
    rangeTtl(endDate),
    // Three tables, two writers: `/api/cron/harri` busts `harri` (positions
    // AND shifts come from that one run) and `/api/cron/otter/hourly` busts
    // `otter`; both bust `dash` and the months they wrote.
    ["harri", ...otterRangeTags(startDate, endDate)],
    () => foldLaborWeekRows({ accountId, storeIds, startDate, endDate }),
  )

  const [salesByDay, salesByStoreDay] = await Promise.all([input.salesByDay, input.salesByStoreDay])
  const missing = missingLaborByDay(fold.missingByDay, salesByStoreDay)

  const days: LaborDay[] = []
  const n = dayCount(range)
  for (let i = 0; i < n; i++) {
    const d = addDays(range.start, i)
    const key = isoDay(d)
    const hb = fold.hoursByDate[key]
    days.push(
      laborDay({
        key,
        label: dayLabel(d),
        actualSeconds: hb?.seconds ?? 0,
        scheduledMinutes: key in fold.scheduledByDate ? fold.scheduledByDate[key] : null,
        matched: fold.matchedByDate[key] ?? null,
        awaitingStoreDays: fold.awaitingByDate[key] ?? 0,
        cost: fold.costByDate[key] ?? 0,
        missingStoreDays: missing[key]?.storeDays ?? 0,
        missingSales: missing[key]?.sales ?? 0,
        totalSales: salesByDay.has(key) ? (salesByDay.get(key) as number) : null,
      }),
    )
  }

  const roles = laborRole([...fold.roles].sort((a, b) => b.cost - a.cost))

  const storeShares = laborStoreShares(
    stores.map((s) => ({ id: s.id, name: s.name })),
    fold.costByStore,
    fold.missingByDay,
    salesByStoreDay,
  )

  return { days, roles, overtimeCost: fold.overtimeCost, storeShares }
}

/**
 * The three row reads and the arithmetic over them, as plain records so they
 * round-trip through Redis. `Record<string, …>` rather than `Map` on purpose:
 * a `Map` serialises to `{}` and would fold to a week that cost nothing.
 */
async function foldLaborWeekRows(input: {
  accountId: string
  storeIds: string[]
  startDate: Date
  endDate: Date
}): Promise<{
  hoursByDate: Record<string, { seconds: number }>
  /** `loadLaborCost`'s decided days, summed over stores. A day not in here is missing. */
  costByDate: Record<string, number>
  /** Per day, the stores with no labor reading (whether or not they sold). */
  missingByDay: Record<string, string[]>
  scheduledByDate: Record<string, number>
  /** Per day, hours worked and minutes published over store-days carrying BOTH. */
  matchedByDate: Record<string, { seconds: number; scheduledMinutes: number }>
  /** Per day, store-days with a published shift and no hours worked yet. */
  awaitingByDate: Record<string, number>
  /** `loadLaborCost`'s decided dollars, per store. */
  costByStore: Record<string, number>
  roles: Array<{ position: string; payType: "HOURLY" | "SALARIED"; hours: number; cost: number }>
  overtimeCost: number
}> {
  const { accountId, storeIds, startDate, endDate } = input

  const [positionRows, shiftRows, laborCost] = await Promise.all([
    prisma.harriPositionDaily.findMany({
      where: { storeId: { in: storeIds }, date: { gte: startDate, lte: endDate } },
      select: {
        storeId: true,
        date: true,
        positionCode: true,
        positionName: true,
        payType: true,
        totalLabor: true,
        actualSeconds: true,
        overtimeAmount: true,
      },
    }),
    // isVirtual: false — an unfilled slot on the grid is not a published
    // hour, same reading as `labor-productivity-actions.ts`.
    prisma.harriShift.findMany({
      where: {
        storeId: { in: storeIds },
        date: { gte: startDate, lte: endDate },
        isVirtual: false,
      },
      select: { storeId: true, date: true, minutes: true },
    }),
    // Labor DOLLARS: the one rule shared with the P&L. The position rows above
    // still give hours and the role split.
    loadLaborCost({ accountId, storeIds, startDate, endDate }),
  ])

  const costByDate: Record<string, number> = {}
  const costByStore: Record<string, number> = {}
  for (const store of Object.values(laborCost.stores)) {
    for (const [day, v] of Object.entries(store.byDay)) {
      costByDate[day] = (costByDate[day] ?? 0) + v.amount
      costByStore[store.storeId] = (costByStore[store.storeId] ?? 0) + v.amount
    }
  }

  // Per store-day, so a schedule is only read against hours on the SAME
  // store-day: a store whose hours Harri has not sent must not count its
  // published shifts as hours nobody worked.
  const secByStoreDay = new Map<string, number>()
  const hoursByDate: Record<string, { seconds: number }> = {}
  const roleAgg = new Map<
    string,
    { position: string; payType: "HOURLY" | "SALARIED"; hours: number; cost: number }
  >()
  let overtimeCost = 0

  for (const r of positionRows) {
    const key = dbDay(r.date)
    const bucket = hoursByDate[key] ?? { seconds: 0 }
    bucket.seconds += r.actualSeconds ?? 0
    hoursByDate[key] = bucket
    const sdKey = `${key}|${r.storeId}`
    secByStoreDay.set(sdKey, (secByStoreDay.get(sdKey) ?? 0) + (r.actualSeconds ?? 0))

    overtimeCost += r.overtimeAmount ?? 0

    const payType: "HOURLY" | "SALARIED" = r.payType === "SALARIED" ? "SALARIED" : "HOURLY"
    const roleKey = `${r.positionCode}|${payType}`
    const role = roleAgg.get(roleKey) ?? {
      position: r.positionName ?? r.positionCode,
      payType,
      hours: 0,
      cost: 0,
    }
    role.hours += (r.actualSeconds ?? 0) / 3600
    role.cost += r.totalLabor ?? 0
    roleAgg.set(roleKey, role)
  }

  const scheduledByDate: Record<string, number> = {}
  const minByStoreDay = new Map<string, number>()
  for (const s of shiftRows) {
    const key = dbDay(s.date)
    scheduledByDate[key] = (scheduledByDate[key] ?? 0) + s.minutes
    const sdKey = `${key}|${s.storeId}`
    minByStoreDay.set(sdKey, (minByStoreDay.get(sdKey) ?? 0) + s.minutes)
  }

  const matchedByDate: Record<string, { seconds: number; scheduledMinutes: number }> = {}
  const awaitingByDate: Record<string, number> = {}
  for (const [sdKey, minutes] of minByStoreDay) {
    const day = sdKey.slice(0, 10)
    const seconds = secByStoreDay.get(sdKey) ?? 0
    if (seconds > 0) {
      const m = (matchedByDate[day] ??= { seconds: 0, scheduledMinutes: 0 })
      m.seconds += seconds
      m.scheduledMinutes += minutes
    } else if (minutes > 0) {
      awaitingByDate[day] = (awaitingByDate[day] ?? 0) + 1
    }
  }

  // Role dollars are Harri's per-position wages; the Total row is the shared
  // labor rule (employer payroll tax included, daily total preferred). Scale
  // the roles onto that total so the table's rows add up to its Total row.
  const roles = [...roleAgg.values()]
  const totalCost = sum(Object.values(costByDate))
  const roleWages = sum(roles.map((r) => r.cost))
  if (roleWages > 0 && totalCost > 0) {
    const scale = totalCost / roleWages
    for (const r of roles) r.cost *= scale
  }

  return {
    hoursByDate,
    costByDate,
    missingByDay: missingStoresByDay(laborCost),
    scheduledByDate,
    matchedByDate,
    awaitingByDate,
    costByStore,
    roles,
    overtimeCost,
  }
}

/**
 * The trailing N weeks of labour, Monday-start, anchored on `endingOn` —
 * `trailingWeeks`'s own contract (note 53), not `buildPeriods`'s
 * Sunday-start weekly bucketing (`src/lib/pnl.ts`), which would mislabel
 * every week in this table against the measured data's own Monday dates.
 * `trailingWeeks` already publishes the running week CLIPPED to `endingOn`
 * with `partial: true` and its real `days` — exactly L-R11's "fewer days
 * than a full week fell inside the data", so nothing here re-derives it.
 *
 * `weeklyTotalSales` is `laborPct`'s ONLY sales input (task 4b), on the same
 * contract `loadLaborWeek`'s `salesByDay` already is: this loader does not
 * query anything sales-related for it — that is the adapter's job, off the
 * SAME `loadStatement` construct the headline reads, so the trend cannot
 * become a second answer to the question the headline already answered.
 * Keyed by `isoDay(week.start)`, the same string this function's own
 * `LaborTrendWeek.key` is; a window with no entry gets `laborPct: null`
 * rather than a silent zero. `OtterHourlySummary` is still queried here,
 * unchanged — that sales figure is `splh`'s, not `laborPct`'s.
 */
export async function loadLaborTrend(input: {
  storeId: string | null
  accountId: string
  /** How many weeks back from the range's end. Twelve on both pages. */
  weeks: number
  endingOn: Date
  /** Per-day Total Sales over the trend's span, keyed `YYYY-MM-DD`. See above. */
  salesByDay: Map<string, number>
  /** The same per store and day — see `salesByStoreDayOf`. */
  salesByStoreDay: Map<string, Map<string, number>>
}): Promise<LaborTrendWeek[]> {
  const { storeId, accountId, weeks, endingOn, salesByDay, salesByStoreDay } = input

  const stores = await getScopedStores(accountId, storeId ?? null)
  if (stores.length === 0) return []
  const storeIds = stores.map((s) => s.id)

  const windows = trailingWeeks(endingOn, weeks)
  if (windows.length === 0) return []

  const { startDate } = toQueryBounds({ start: windows[0].start, end: windows[0].start })
  const last = windows[windows.length - 1]
  const { endDate } = toQueryBounds({ start: last.end, end: last.end })

  // Same rule as `loadLaborWeek`: the fold is cached, `weeklyTotalSales` is
  // the statement's and stays outside.
  const { costByDate, hoursByDate, missingByDay } = await cached(
    `counter:labortrend4:${stableKey({ a: accountId, ids: [...storeIds].sort(), from: startDate, to: endDate })}`,
    rangeTtl(endDate),
    ["harri", ...otterRangeTags(startDate, endDate)],
    () => foldLaborTrendRows({ accountId, storeIds, startDate, endDate }),
  )

  const missing = missingLaborByDay(missingByDay, salesByStoreDay)

  return windows.map((w) => {
    const days: TrendDayInput[] = []
    for (let i = 0; i < w.days; i++) {
      const d = addDays(w.start, i)
      const key = isoDay(d)
      days.push({
        cost: costByDate[key] ?? 0,
        hours: hoursByDate[key] ?? 0,
        sales: salesByDay.has(key) ? (salesByDay.get(key) as number) : null,
        missingStoreDays: missing[key]?.storeDays ?? 0,
        missingSales: missing[key]?.sales ?? 0,
      })
    }
    return laborTrendWeek(w.start, w.partial, days)
  })
}

/** The two row reads behind the trend, as plain records for the same reason as `foldLaborWeekRows`. */
async function foldLaborTrendRows(input: {
  accountId: string
  storeIds: string[]
  startDate: Date
  endDate: Date
}): Promise<{
  /** `loadLaborCost`'s decided days, summed over stores. A day not in here is missing. */
  costByDate: Record<string, number>
  hoursByDate: Record<string, number>
  missingByDay: Record<string, string[]>
}> {
  const { accountId, storeIds, startDate, endDate } = input

  const [positionRows, laborCost] = await Promise.all([
    prisma.harriPositionDaily.findMany({
      where: { storeId: { in: storeIds }, date: { gte: startDate, lte: endDate } },
      select: { date: true, actualSeconds: true },
    }),
    loadLaborCost({ accountId, storeIds, startDate, endDate }),
  ])

  const costByDate: Record<string, number> = {}
  for (const store of Object.values(laborCost.stores)) {
    for (const [day, v] of Object.entries(store.byDay)) {
      costByDate[day] = (costByDate[day] ?? 0) + v.amount
    }
  }
  const hoursByDate: Record<string, number> = {}
  for (const r of positionRows) {
    const key = dbDay(r.date)
    hoursByDate[key] = (hoursByDate[key] ?? 0) + (r.actualSeconds ?? 0) / 3600
  }

  return { costByDate, hoursByDate, missingByDay: missingStoresByDay(laborCost) }
}
