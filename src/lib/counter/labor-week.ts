import { addDays } from "date-fns"
import { prisma } from "@/lib/prisma"
import { getScopedStores } from "@/lib/account-stores"
import { cached, stableKey } from "@/lib/cache/cached"
import { otterRangeTags, rangeTtl } from "@/lib/cache/range"
import { loadLaborCost } from "@/lib/counter/labor-cost"
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
   * No labor reading for this day in either Harri table (`loadLaborCost`'s
   * MISSING). `cost` is 0 then, but the day was not free — it was not synced.
   */
  costMissing: boolean
  /** Total Sales over hours worked. `null` with no hours or no sales — never `0`. */
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
}

export interface LaborWeek {
  days: LaborDay[]
  actualHours: number
  scheduledHours: number | null
  cost: number
  /** Days that sold something but have no labor reading — the week's labor total is short by them. */
  missingCostDays: number
  /** `cost / actualHours`. The rate the leak ledger costs its hours at. */
  blendedRate: number | null
  splh: number | null
  /** Over TOTAL SALES (L-R2). */
  laborPct: number | null
  overtimeCost: number
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
  cost: number
  /** `loadLaborCost` found no reading for the day. */
  costMissing?: boolean
  /** Off the statement's Total Sales row — the denominator of BOTH `laborPct` and `splh`. */
  totalSales: number | null
}): LaborDay {
  const actualHours = input.actualSeconds / 3600
  const scheduledHours =
    input.scheduledMinutes === null ? null : input.scheduledMinutes / 60
  const splh =
    input.totalSales === null || !Number.isFinite(input.totalSales) || actualHours === 0
      ? null
      : input.totalSales / actualHours
  const laborPct = pctOfSales(input.cost, input.totalSales)

  return {
    key: input.key,
    label: input.label,
    actualHours,
    scheduledHours,
    cost: input.cost,
    costMissing: input.costMissing ?? false,
    splh,
    laborPct,
    totalSales: input.totalSales,
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
export function laborWeek(days: LaborDay[], overtimeCost: number): LaborWeek {
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
  const splhSales = sum(splhKnown.map((d) => d.totalSales as number))
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
    (d) => d.totalSales !== null && Number.isFinite(d.totalSales),
  )
  const totalSales =
    salesKnown.length === 0 ? null : sum(salesKnown.map((d) => d.totalSales as number))
  const laborPct = pctOfSales(cost, totalSales)

  const missingCostDays = days.filter((d) => d.costMissing && (d.totalSales ?? 0) > 0).length

  return {
    days,
    actualHours,
    scheduledHours,
    cost,
    missingCostDays,
    blendedRate,
    splh,
    laborPct,
    overtimeCost,
  }
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
  totalSales: number | null,
): LaborTrendWeek {
  const cost = sum(days.map((d) => d.cost))
  const hours = sum(days.map((d) => d.hours))

  return {
    key: isoDay(weekStart),
    label: monthDay(weekStart),
    cost,
    hours,
    laborPct: pctOfSales(cost, totalSales),
    splh: totalSales !== null && Number.isFinite(totalSales) && hours > 0 ? totalSales / hours : null,
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
  /** Per-day Total Sales, keyed `YYYY-MM-DD`, off the statement the page already loaded. */
  salesByDay: Map<string, number>
}): Promise<{ days: LaborDay[]; roles: LaborRole[]; overtimeCost: number }> {
  const { range, storeId, accountId, salesByDay } = input
  const { startDate, endDate } = toQueryBounds(range)

  const stores = await getScopedStores(accountId, storeId ?? null)
  // A storeId that is not on this account resolves to no stores, not to the
  // whole account (same rule as `loadChannelMix`/`loadServiceProfile`).
  if (stores.length === 0) return { days: [], roles: [], overtimeCost: 0 }
  const storeIds = stores.map((s) => s.id)

  // The FOLD is cached, never the rows — every row here carries a `Date` that
  // `dbDay` reads with `toISOString()`, which a string back from Redis lacks.
  // `salesByDay` stays OUTSIDE: it is the statement's figure, already cached
  // under its own key, and it only enters at `laborDay` below. Folding it in
  // would make this key move with the statement instead of with labour.
  const fold = await cached(
    `counter:laborweek2:${stableKey({ a: accountId, ids: [...storeIds].sort(), from: startDate, to: endDate })}`,
    rangeTtl(endDate),
    // Three tables, two writers: `/api/cron/harri` busts `harri` (positions
    // AND shifts come from that one run) and `/api/cron/otter/hourly` busts
    // `otter`; both bust `dash` and the months they wrote.
    ["harri", ...otterRangeTags(startDate, endDate)],
    () => foldLaborWeekRows({ accountId, storeIds, startDate, endDate }),
  )

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
        cost: fold.costByDate[key] ?? 0,
        costMissing: !(key in fold.costByDate),
        totalSales: salesByDay.has(key) ? (salesByDay.get(key) as number) : null,
      }),
    )
  }

  const roles = laborRole([...fold.roles].sort((a, b) => b.cost - a.cost))

  return { days, roles, overtimeCost: fold.overtimeCost }
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
  scheduledByDate: Record<string, number>
  roles: Array<{ position: string; payType: "HOURLY" | "SALARIED"; hours: number; cost: number }>
  overtimeCost: number
}> {
  const { accountId, storeIds, startDate, endDate } = input

  const [positionRows, shiftRows, laborCost] = await Promise.all([
    prisma.harriPositionDaily.findMany({
      where: { storeId: { in: storeIds }, date: { gte: startDate, lte: endDate } },
      select: {
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
      select: { date: true, minutes: true },
    }),
    // Labor DOLLARS: the one rule shared with the P&L. The position rows above
    // still give hours and the role split.
    loadLaborCost({ accountId, storeIds, startDate, endDate }),
  ])

  const costByDate: Record<string, number> = {}
  for (const store of Object.values(laborCost.stores)) {
    for (const [day, v] of Object.entries(store.byDay)) {
      costByDate[day] = (costByDate[day] ?? 0) + v.amount
    }
  }

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
  for (const s of shiftRows) {
    const key = dbDay(s.date)
    scheduledByDate[key] = (scheduledByDate[key] ?? 0) + s.minutes
  }

  return { hoursByDate, costByDate, scheduledByDate, roles: [...roleAgg.values()], overtimeCost }
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
  /** This week's Total Sales, keyed `isoDay(week.start)`. See above. */
  weeklyTotalSales: Map<string, number>
}): Promise<LaborTrendWeek[]> {
  const { storeId, accountId, weeks, endingOn, weeklyTotalSales } = input

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
  const { costByDate, hoursByDate } = await cached(
    `counter:labortrend2:${stableKey({ a: accountId, ids: [...storeIds].sort(), from: startDate, to: endDate })}`,
    rangeTtl(endDate),
    ["harri", ...otterRangeTags(startDate, endDate)],
    () => foldLaborTrendRows({ accountId, storeIds, startDate, endDate }),
  )

  return windows.map((w) => {
    const days: TrendDayInput[] = []
    for (let i = 0; i < w.days; i++) {
      const d = addDays(w.start, i)
      const key = isoDay(d)
      days.push({
        cost: costByDate[key] ?? 0,
        hours: hoursByDate[key] ?? 0,
      })
    }
    const weekKey = isoDay(w.start)
    const totalSales = weeklyTotalSales.has(weekKey) ? (weeklyTotalSales.get(weekKey) as number) : null
    return laborTrendWeek(w.start, w.partial, days, totalSales)
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

  return { costByDate, hoursByDate }
}
