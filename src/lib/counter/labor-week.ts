import { addDays } from "date-fns"
import { prisma } from "@/lib/prisma"
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
 * ## The central ruling: two sales figures, on purpose
 *
 * This module reads TWO different sales figures, for two different
 * questions, and neither may leak into the other's answer:
 *
 * - **`laborPct` is taken on TOTAL SALES** — the same figure the P&L prints
 *   (`getAllStoresPnL`'s `grossSales`, `TOTAL_SALES_CODE` on the statement).
 *   That figure is NOT queried here: `loadLaborWeek` takes it in as
 *   `salesByDay`, off the daily statement the page already loaded. A loader
 *   that queried its own Total Sales would be a second place that number
 *   could drift from the P&L's, and two pages printing two labour percentages
 *   for the same week is the exact defect this module exists to close.
 * - **`splh` is taken on PLATFORM sales** (`OtterHourlySummary.netSales`) —
 *   the same source every existing SPLH view in this codebase already reads
 *   (`src/app/actions/labor-productivity-actions.ts`, `src/app/actions/
 *   splh-actions.ts`, `src/lib/splh.ts`). SPLH answers "how much business did
 *   an hour of labour produce", which is not a question about the P&L's
 *   revenue line, and switching its denominator to Total Sales would make
 *   this page's SPLH disagree with the SPLH already shown everywhere else
 *   in the product. The measured twelve-week table's own column is headed
 *   "% of platform sales" for the same reason: the TREND read here uses
 *   platform sales for both `splh` and `laborPct`, and only the CURRENT
 *   week's `laborPct` — the figure that sits beside the P&L on the page —
 *   is pinned to Total Sales.
 *
 * `loadLaborWeek` therefore queries `OtterHourlySummary` itself for SPLH's
 * sales even though Total Sales is handed in — that is not the "second
 * query" the interface note warns against, because it is answering a
 * question (platform sales per day) the statement never answered in the
 * first place.
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
  /** Sales over hours worked. `null` with no hours — never `0`. */
  splh: number | null
  /** This day's labour over this day's Total Sales, 0..100. `null` with no sales. */
  laborPct: number | null
}

export interface LaborWeek {
  days: LaborDay[]
  actualHours: number
  scheduledHours: number | null
  cost: number
  /** `cost / actualHours`. The rate the leak ledger costs its hours at. */
  blendedRate: number | null
  splh: number | null
  /** Over TOTAL SALES, not platform sales (L-R2). */
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
  /** Over PLATFORM sales — see the module comment. `null` with no sales data. */
  laborPct: number | null
  splh: number | null
  /** Fewer days than a full week fell inside the data (L-R11). */
  isPartial: boolean
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0)
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
  /** Off `OtterHourlySummary` — SPLH's sales figure. NOT Total Sales. */
  platformSales: number | null
  /** Off the statement's Total Sales row — `laborPct`'s ONLY denominator. */
  totalSales: number | null
}): LaborDay {
  const actualHours = input.actualSeconds / 3600
  const scheduledHours =
    input.scheduledMinutes === null ? null : input.scheduledMinutes / 60
  const splh =
    input.platformSales === null || actualHours === 0
      ? null
      : input.platformSales / actualHours
  const laborPct =
    input.totalSales === null || input.totalSales === 0
      ? null
      : (input.cost / input.totalSales) * 100

  return {
    key: input.key,
    label: input.label,
    actualHours,
    scheduledHours,
    cost: input.cost,
    splh,
    laborPct,
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
  const platformSales = sum(splhKnown.map((d) => (d.splh as number) * d.actualHours))
  const splh = splhHours > 0 ? platformSales / splhHours : null

  const pctKnown = days.filter((d) => d.laborPct !== null)
  const totalSales = sum(
    pctKnown.map((d) => d.cost / ((d.laborPct as number) / 100)),
  )
  const laborPct = totalSales > 0 ? (cost / totalSales) * 100 : null

  return { days, actualHours, scheduledHours, cost, blendedRate, splh, laborPct, overtimeCost }
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
  /** Off `OtterHourlySummary` — see the module comment on why the trend
   *  keeps the platform-sales convention rather than L-R2's Total-Sales
   *  rule, which is scoped to the current week's card. */
  platformSales: number | null
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
 */
export function laborTrendWeek(
  weekStart: Date,
  isPartial: boolean,
  days: TrendDayInput[],
): LaborTrendWeek {
  const cost = sum(days.map((d) => d.cost))
  const hours = sum(days.map((d) => d.hours))
  const known = days.filter((d) => d.platformSales !== null)
  const sales = known.length > 0 ? sum(known.map((d) => d.platformSales as number)) : null

  return {
    key: isoDay(weekStart),
    label: monthDay(weekStart),
    cost,
    hours,
    laborPct: sales !== null && sales > 0 ? (cost / sales) * 100 : null,
    splh: sales !== null && hours > 0 ? sales / hours : null,
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

  const stores = await prisma.store.findMany({
    where: {
      accountId,
      isActive: true,
      ...(storeId ? { id: storeId } : {}),
    },
    select: { id: true },
  })
  // A storeId that is not on this account resolves to no stores, not to the
  // whole account (same rule as `loadChannelMix`/`loadServiceProfile`).
  if (stores.length === 0) return { days: [], roles: [], overtimeCost: 0 }
  const storeIds = stores.map((s) => s.id)

  const [positionRows, shiftRows, platformRows] = await Promise.all([
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
    prisma.otterHourlySummary.findMany({
      where: { storeId: { in: storeIds }, date: { gte: startDate, lte: endDate } },
      select: { date: true, netSales: true },
    }),
  ])

  const hoursByDate = new Map<string, { seconds: number; cost: number }>()
  const roleAgg = new Map<
    string,
    { position: string; payType: "HOURLY" | "SALARIED"; hours: number; cost: number }
  >()
  let overtimeCost = 0

  for (const r of positionRows) {
    const key = dbDay(r.date)
    const bucket = hoursByDate.get(key) ?? { seconds: 0, cost: 0 }
    bucket.seconds += r.actualSeconds ?? 0
    bucket.cost += r.totalLabor ?? 0
    hoursByDate.set(key, bucket)

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

  const scheduledByDate = new Map<string, number>()
  for (const s of shiftRows) {
    const key = dbDay(s.date)
    scheduledByDate.set(key, (scheduledByDate.get(key) ?? 0) + s.minutes)
  }

  const platformByDate = new Map<string, number>()
  for (const p of platformRows) {
    const key = dbDay(p.date)
    platformByDate.set(key, (platformByDate.get(key) ?? 0) + (p.netSales ?? 0))
  }

  const days: LaborDay[] = []
  const n = dayCount(range)
  for (let i = 0; i < n; i++) {
    const d = addDays(range.start, i)
    const key = isoDay(d)
    const hb = hoursByDate.get(key)
    days.push(
      laborDay({
        key,
        label: dayLabel(d),
        actualSeconds: hb?.seconds ?? 0,
        scheduledMinutes: scheduledByDate.has(key) ? (scheduledByDate.get(key) as number) : null,
        cost: hb?.cost ?? 0,
        platformSales: platformByDate.has(key) ? (platformByDate.get(key) as number) : null,
        totalSales: salesByDay.has(key) ? (salesByDay.get(key) as number) : null,
      }),
    )
  }

  const roles = laborRole([...roleAgg.values()].sort((a, b) => b.cost - a.cost))

  return { days, roles, overtimeCost }
}

/**
 * The trailing N weeks of labour, Monday-start, anchored on `endingOn` —
 * `trailingWeeks`'s own contract (note 53), not `buildPeriods`'s
 * Sunday-start weekly bucketing (`src/lib/pnl.ts`), which would mislabel
 * every week in this table against the measured data's own Monday dates.
 * `trailingWeeks` already publishes the running week CLIPPED to `endingOn`
 * with `partial: true` and its real `days` — exactly L-R11's "fewer days
 * than a full week fell inside the data", so nothing here re-derives it.
 */
export async function loadLaborTrend(input: {
  storeId: string | null
  accountId: string
  /** How many weeks back from the range's end. Twelve on both pages. */
  weeks: number
  endingOn: Date
}): Promise<LaborTrendWeek[]> {
  const { storeId, accountId, weeks, endingOn } = input

  const stores = await prisma.store.findMany({
    where: {
      accountId,
      isActive: true,
      ...(storeId ? { id: storeId } : {}),
    },
    select: { id: true },
  })
  if (stores.length === 0) return []
  const storeIds = stores.map((s) => s.id)

  const windows = trailingWeeks(endingOn, weeks)
  if (windows.length === 0) return []

  const { startDate } = toQueryBounds({ start: windows[0].start, end: windows[0].start })
  const last = windows[windows.length - 1]
  const { endDate } = toQueryBounds({ start: last.end, end: last.end })

  const [positionRows, platformRows] = await Promise.all([
    prisma.harriPositionDaily.findMany({
      where: { storeId: { in: storeIds }, date: { gte: startDate, lte: endDate } },
      select: { date: true, totalLabor: true, actualSeconds: true },
    }),
    prisma.otterHourlySummary.findMany({
      where: { storeId: { in: storeIds }, date: { gte: startDate, lte: endDate } },
      select: { date: true, netSales: true },
    }),
  ])

  const costByDate = new Map<string, number>()
  const hoursByDate = new Map<string, number>()
  for (const r of positionRows) {
    const key = dbDay(r.date)
    costByDate.set(key, (costByDate.get(key) ?? 0) + (r.totalLabor ?? 0))
    hoursByDate.set(key, (hoursByDate.get(key) ?? 0) + (r.actualSeconds ?? 0) / 3600)
  }

  const salesByDate = new Map<string, number>()
  for (const p of platformRows) {
    const key = dbDay(p.date)
    salesByDate.set(key, (salesByDate.get(key) ?? 0) + (p.netSales ?? 0))
  }

  return windows.map((w) => {
    const days: TrendDayInput[] = []
    for (let i = 0; i < w.days; i++) {
      const d = addDays(w.start, i)
      const key = isoDay(d)
      days.push({
        cost: costByDate.get(key) ?? 0,
        hours: hoursByDate.get(key) ?? 0,
        platformSales: salesByDate.has(key) ? (salesByDate.get(key) as number) : null,
      })
    }
    return laborTrendWeek(w.start, w.partial, days)
  })
}
