import { prisma } from "@/lib/prisma"
import { getScopedStores } from "@/lib/account-stores"
import { toQueryBounds } from "@/lib/counter/date-range"
import { serviceDayOrder } from "@/lib/counter/service-profile"
import { newestGenerationPerHour } from "@/lib/counter/forecast-generation"

/**
 * How many people the published schedule puts on the floor each hour,
 * against how many orders the forecast expects in that hour — and the days
 * the forecast covers that the schedule does not (L-R6, L-R7, L-R8, L-R9).
 *
 * ## `shiftHours` is the trap
 *
 * `HarriShift.startTime`/`.endTime` hold LOCAL wall-clock encoded as UTC —
 * the schema says so on the model itself — so both are read with
 * `getUTCHours()`, never a timezone conversion. Real shifts here run `9→17`,
 * `12→17`, `17→1`, `18→1`, `20→1`. A `17→1` shift staffs hours `17, 18, 19,
 * 20, 21, 22, 23` AND `0` — the busiest hours of the night, measured. `end`
 * is EXCLUSIVE (a shift clocking out at 1am does not staff the 1am hour),
 * which is what makes `9→17` land on `[9..16]` and not `[9..17]`.
 *
 * ## The hour axis is the service day (L-R7)
 *
 * `staffingCurve`'s `hours` come back in the same rotation
 * `service-profile.ts`'s `serviceDayOrder` computes for the Analytics hourly
 * chart — first trading hour through past midnight, never clock order — so
 * the two pages read this restaurant's day the same way. Reused directly,
 * not reimplemented: two rotations of the same restaurant's day could
 * disagree about where it starts.
 *
 * ## The forecast dedupe (L-R6)
 *
 * `ForecastHourlyOrders` is unique on `(storeId, forecastDate, hourBucket,
 * generatedAt)` and keeps every model generation. Summed raw over the
 * labour window that is 35,020 orders against a deduped 2,658 — 13.17x.
 * `newestGenerationPerHour`, beside `newestGenerationPerDay` in
 * `forecast-generation.ts`, is where the Counter layer dedupes; both loaders
 * here go through it rather than summing `ForecastHourlyOrders` directly.
 *
 * It is NOT the only implementation in the repository, which this used to
 * claim. `ForecastDailyRevenue` is deduped by a hand-rolled
 * latest-per-(store, date) map in both
 * `src/app/actions/forecasts/food-cost-forecast-actions.ts` and
 * `src/app/actions/forecasts/labor-staffing-actions.ts`. Both are CORRECT —
 * audited 2026-09-03, they keep the newest `generatedAt` exactly as the
 * helper does — so there is no bug to chase, only three copies of one idea.
 * The sentence mattered because "the one place" is what stops someone
 * checking, and a future change to the helper would leave those two behind.
 *
 * ## Scoping
 *
 * Both loaders resolve stores through `accountId` FIRST, the same rule as
 * `loadChannelMix`/`loadServiceProfile`/`loadLaborWeek`: without it,
 * `storeId: null` means every store in the database, not every store on
 * this account. This module deliberately does not import `@/lib/auth` —
 * that pulls in `@/lib/prisma` at MODULE LOAD, which throws without
 * `DATABASE_URL` and takes every importer down with it, tests included. The
 * page already has an `accountId` from its own session lookup.
 */

export interface StaffedHour {
  hour: number
  /** People on the clock in this hour, from the published schedule. */
  scheduled: number
  /** Forecast orders in this hour, newest generation only (L-R6). `null` where none. */
  demand: number | null
}

export interface StaffingCurve {
  /** In SERVICE-DAY order, not clock order — see `service-profile.ts` (L-R7). */
  hours: StaffedHour[]
  /** The hour where demand most outruns the schedule, or `null`. */
  tightest: number | null
  /** One sentence, computed (L-R9). */
  sentence: string
}

/**
 * Which hours a shift staffs. A shift ending after midnight covers both
 * sides of it (L-R7).
 *
 * `endHour` is EXCLUSIVE — the hour the shift clocks out is not staffed —
 * which is the only way `shiftHours(9, 17)` can land on eight hours
 * (`9..16`) rather than nine. Walking forward with modular arithmetic (never
 * comparing `end < start` and bailing) is what makes the midnight case fall
 * out for free: `shiftHours(17, 1)` walks `17, 18, … 23, 0` and stops the
 * instant it reaches `1`, without ever needing to know that `1 < 17`.
 */
export function shiftHours(startHour: number, endHour: number): number[] {
  const start = ((startHour % 24) + 24) % 24
  const end = ((endHour % 24) + 24) % 24

  const hours: number[] = []
  let h = start
  while (h !== end) {
    hours.push(h)
    h = (h + 1) % 24
  }
  return hours
}

/** "38.4" — one decimal, matching the measured tables this module is built against. */
function fmtDemand(n: number): string {
  return n.toFixed(1)
}

/**
 * The staffing-curve sentence (L-R9): the hour demand most outruns the
 * schedule, and the hour right after it, in the restaurant's own numbers.
 * Measured for 2026-08-28: 3 people against 38.4 forecast orders at 20h,
 * then 6 people against 36.1 at 21h — the shape the prototype's line ("the
 * shape, not the total, is what costs you") describes, kept because it is
 * still true, with every number in it now ours.
 *
 * `tightest === null` means no hour in the curve carries a forecast at all
 * (an empty `demand` map, or a day with no forecast rows) — there is nothing
 * to compare the schedule against, so the sentence says that plainly rather
 * than describing a shape that isn't there.
 */
function staffingSentence(hours: StaffedHour[], tightest: number | null): string {
  if (tightest === null) {
    return "No demand forecast overlaps this day's schedule."
  }

  const byHour = new Map(hours.map((h) => [h.hour, h]))
  const at = byHour.get(tightest)
  // Cannot happen — `tightest` is only ever set to a hour drawn from `hours`
  // itself — but keeps this function total rather than trusting the caller.
  if (!at || at.demand === null) return "No demand forecast overlaps this day's schedule."

  const nextHour = (tightest + 1) % 24
  const next = byHour.get(nextHour)

  if (next && next.demand !== null) {
    return (
      `At ${at.hour}h, ${at.scheduled} people meet ${fmtDemand(at.demand)} forecast orders; ` +
      `by ${next.hour}h it's ${next.scheduled} people against ${fmtDemand(next.demand)} — ` +
      `the shape, not the total, is what costs you.`
    )
  }

  return (
    `At ${at.hour}h, ${at.scheduled} people meet ${fmtDemand(at.demand)} forecast orders — ` +
    `the shape, not the total, is what costs you.`
  )
}

/**
 * Pure. `shifts` staffs each hour it covers by one; `demand` is the
 * already-deduped forecast (the loader runs `newestGenerationPerHour`
 * before calling this). The hour axis is every hour something actually
 * HAPPENS in — a shift covers it, or the forecast is greater than zero — in
 * service-day order (L-R7). An hour with no shift and no forecast is not a
 * row, and neither is an hour whose only claim is a forecast bucket of 0:
 * `ForecastHourlyOrders` publishes all 24 hours whether the restaurant is
 * open or not, and taking that at face value leaves the rotation no gap to
 * turn on (see the comment in the body).
 *
 * `tightest` is the hour that maximises `demand - scheduled` over hours with
 * a forecast — "most outruns", not "most understaffed by ratio" — ties
 * broken by whichever comes first in service-day order. `null` when no hour
 * carries a forecast.
 */
export function staffingCurve(
  shifts: Array<{ startHour: number; endHour: number }>,
  demand: Map<number, number>,
): StaffingCurve {
  const scheduledByHour = new Map<number, number>()
  for (const s of shifts) {
    for (const h of shiftHours(s.startHour, s.endHour)) {
      scheduledByHour.set(h, (scheduledByHour.get(h) ?? 0) + 1)
    }
  }

  // A TRADING hour: someone is on the clock, or the forecast expects an order.
  // A forecast bucket of ZERO is not a trading hour, and this is the whole of
  // the rotation bug it caused: `ForecastHourlyOrders` publishes every hour of
  // the day, most of them 0, so a set built from `demand.keys()` is all 24
  // hours — a ring with no gap in it. `serviceDayOrder` rotates on the LARGEST
  // gap, so with no gap to find it degenerates to clock order and the axis
  // reads `12a … 12p … 11p`, burying the evening rush against the right edge.
  // Measured 2026-08-27: shifts cover 9…23 and 0, the forecast is > 0 at 0 and
  // 10…23; the union is `0, 9…23`, whose largest gap is 1…8, so the axis starts
  // at 9 and ends past midnight — the same day shape the Analytics hourly chart
  // reads off `OtterHourlySummary`, which never publishes an empty hour at all.
  const present = Array.from(
    new Set<number>([
      ...scheduledByHour.keys(),
      ...Array.from(demand.entries())
        .filter(([, orders]) => orders > 0)
        .map(([hour]) => hour),
    ]),
  ).sort((a, b) => a - b)
  const order = serviceDayOrder(present)

  const hours: StaffedHour[] = order.map((h) => ({
    hour: h,
    scheduled: scheduledByHour.get(h) ?? 0,
    demand: demand.has(h) ? (demand.get(h) as number) : null,
  }))

  let tightest: number | null = null
  let bestGap = -Infinity
  for (const row of hours) {
    if (row.demand === null) continue
    const gap = row.demand - row.scheduled
    if (gap > bestGap) {
      bestGap = gap
      tightest = row.hour
    }
  }

  return { hours, tightest, sentence: staffingSentence(hours, tightest) }
}

/**
 * A calendar day off a `@db.Date` column, read with UTC getters — same
 * function as `labor-week.ts`'s `dbDay` and `service-profile.ts`'s
 * `dateKey`, kept local here for the same reason both of those give: a
 * three-line read is not a shared abstraction worth a fourth import.
 */
function dbDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

interface ForecastRow {
  storeId: string
  forecastDate: Date
  hourBucket: number
  predictedOrders: number
  generatedAt: Date
}

/**
 * The staffing curve for one day, queried.
 *
 * `null` when the account has no matching store (a `storeId` not on this
 * account resolves to no stores, never to the whole account — same rule as
 * `loadChannelMix`), or when the day carries neither a published shift nor a
 * forecast row at all: nothing to draw is `not_computed`, not an empty
 * chart (A-R12/L-R12's rule, applied here).
 *
 * Virtual shifts (`isVirtual: true` — an unfilled slot the manager left on
 * the grid) are excluded from `scheduled`, matching `loadLaborWeek`'s
 * `scheduledHours` and `labor-productivity-actions.ts`'s reading: an
 * unfilled slot has no person on the floor.
 */
export async function loadStaffingCurve(input: {
  date: Date
  storeId: string | null
  accountId: string
}): Promise<StaffingCurve | null> {
  const { date, storeId, accountId } = input

  const stores = await getScopedStores(accountId, storeId ?? null)
  if (stores.length === 0) return null
  const storeIds = stores.map((s) => s.id)

  const { startDate, endDate } = toQueryBounds({ start: date, end: date })

  const [shiftRows, forecastRows] = await Promise.all([
    prisma.harriShift.findMany({
      where: {
        storeId: { in: storeIds },
        date: { gte: startDate, lte: endDate },
        isVirtual: false,
      },
      select: { startTime: true, endTime: true },
    }),
    prisma.forecastHourlyOrders.findMany({
      where: {
        storeId: { in: storeIds },
        forecastDate: { gte: startDate, lte: endDate },
      },
      select: {
        storeId: true,
        forecastDate: true,
        hourBucket: true,
        predictedOrders: true,
        generatedAt: true,
      },
    }),
  ])

  if (shiftRows.length === 0 && forecastRows.length === 0) return null

  const shifts = shiftRows.map((s) => ({
    startHour: s.startTime.getUTCHours(),
    endHour: s.endTime.getUTCHours(),
  }))

  const demand = new Map<number, number>()
  for (const r of newestGenerationPerHour(forecastRows as ForecastRow[])) {
    demand.set(r.hourBucket, (demand.get(r.hourBucket) ?? 0) + r.predictedOrders)
  }

  return staffingCurve(shifts, demand)
}

/**
 * Pure. Every date the (deduped) forecast covers, that `scheduledDates`
 * does not — L-R8's "days the forecast covers and the schedule does not",
 * split out from `loadScheduleGap` so its assertion is testable without
 * mocking Prisma (same reasoning as `labor-week.ts`'s `laborRole`/
 * `laborTrendWeek`).
 *
 * A date present in both is not a gap, however much of it is short-staffed
 * — this answers "did anyone even schedule this day", not "was the
 * schedule enough". Sorted ascending, so a caller can render it as a queue
 * directly.
 */
export function scheduleGap(input: {
  scheduledDates: Set<string>
  forecastRows: ForecastRow[]
}): Array<{ date: string; forecastOrders: number }> {
  const ordersByDate = new Map<string, number>()
  for (const r of newestGenerationPerHour(input.forecastRows)) {
    const key = dbDay(r.forecastDate)
    ordersByDate.set(key, (ordersByDate.get(key) ?? 0) + r.predictedOrders)
  }

  return Array.from(ordersByDate.entries())
    .filter(([date]) => !input.scheduledDates.has(date))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, forecastOrders]) => ({ date, forecastOrders }))
}

/**
 * The queried half of L-R8: every date `>= from` with a schedule (ANY
 * `HarriShift` row, virtual included — this is "was a schedule published at
 * all", the same existence check `loadLaborWeek` uses for `scheduledHours:
 * null`, not a sum of published hours) versus every date the forecast
 * covers, deduped. Measured: from 2026-08-27, the schedule runs through
 * 2026-08-30 while the forecast runs to 2026-09-09 — the gap starts
 * 2026-08-31, not 2026-08-30, which has a schedule (however short).
 */
export async function loadScheduleGap(input: {
  storeId: string | null
  accountId: string
  from: Date
}): Promise<Array<{ date: string; forecastOrders: number }>> {
  const { storeId, accountId, from } = input

  const stores = await getScopedStores(accountId, storeId ?? null)
  if (stores.length === 0) return []
  const storeIds = stores.map((s) => s.id)

  const { startDate: fromDate } = toQueryBounds({ start: from, end: from })

  const [shiftRows, forecastRows] = await Promise.all([
    prisma.harriShift.findMany({
      where: { storeId: { in: storeIds }, date: { gte: fromDate } },
      select: { date: true },
    }),
    prisma.forecastHourlyOrders.findMany({
      where: { storeId: { in: storeIds }, forecastDate: { gte: fromDate } },
      select: {
        storeId: true,
        forecastDate: true,
        hourBucket: true,
        predictedOrders: true,
        generatedAt: true,
      },
    }),
  ])

  const scheduledDates = new Set(shiftRows.map((s) => dbDay(s.date)))

  return scheduleGap({
    scheduledDates,
    forecastRows: forecastRows as ForecastRow[],
  })
}
