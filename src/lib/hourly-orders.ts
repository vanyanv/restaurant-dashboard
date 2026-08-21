// Shared helpers for "Service by the hour" — the period spec calculator and
// the row-bucketing/averaging/pace logic. Extracted from store-actions.ts so
// both the live Otter path and the precomputed OtterHourlySummary path produce
// identical numbers (logic parity guaranteed by single source of truth, not by
// hope during cutover).

import type {
  HourlyComparisonPeriod,
  HourlyOrderPoint,
  OrderPatternsHourlyComparison,
} from "@/types/analytics"
import {
  addDaysLA,
  resolveRangeDates,
  todayInLA,
  type DashboardRange,
} from "@/lib/dashboard-utils"

export const HOUR_LABELS = [
  "12 AM", "1 AM", "2 AM", "3 AM", "4 AM", "5 AM",
  "6 AM", "7 AM", "8 AM", "9 AM", "10 AM", "11 AM",
  "12 PM", "1 PM", "2 PM", "3 PM", "4 PM", "5 PM",
  "6 PM", "7 PM", "8 PM", "9 PM", "10 PM", "11 PM",
] as const

export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const

export interface PaceLine {
  /** Signed percentage, for callers that colour by direction. */
  value: number
  /** Rendered line, e.g. "▲ 4% vs avg Mon · thru 1 PM". */
  display: string
}

/**
 * Format a today-so-far comparison: the current partial day against the average
 * of the same weekday's *same hours* over the trailing baseline weeks.
 *
 * This is the only correct way to compare a day in progress. Comparing a
 * partial day against a complete prior day reads as a collapse every morning —
 * mobile did exactly that and reported −88% at 1:16 PM on a day the desktop
 * (which already used this logic) correctly reported as +4%. Both surfaces now
 * call this, so they cannot disagree again.
 *
 * Returns null when there aren't at least two baseline weeks to average, in
 * which case callers must show no delta rather than an unstable one.
 */
export function formatPaceLine(
  cmp: OrderPatternsHourlyComparison | null | undefined,
  pct: number | null | undefined,
): PaceLine | null {
  if (!cmp || pct == null || cmp.baselineWeeks < 2) return null
  const arrow = pct > 0 ? "▲" : pct < 0 ? "▼" : "·"
  // "thru 4 PM" is only meaningful while the range is still filling. On a
  // finished day it announced the last hour the kitchen took an order (
  // "thru 10 PM"), which reads as a cutoff that was never applied.
  const thru =
    cmp.inProgress && cmp.lastDataHour != null
      ? ` · thru ${HOUR_LABELS[cmp.lastDataHour]}`
      : ""
  return {
    value: pct,
    display: `${arrow} ${Math.abs(pct).toFixed(0)}% vs avg ${cmp.weekdayLabel}${thru}`,
  }
}

export function emptyHourly(): HourlyOrderPoint[] {
  return Array.from({ length: 24 }, (_, i) => ({
    hour: i,
    label: HOUR_LABELS[i],
    orderCount: 0,
    totalSales: 0,
    avgOrderCount: 0,
    avgTotalSales: 0,
  }))
}

/** Current LA hour (0–23). */
export function getCurrentLAHour(): number {
  return parseInt(
    new Date().toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
      hour: "numeric",
      hour12: false,
    })
  )
}

/** YYYY-MM-DD `n` days before `dateStr` (LA-naive arithmetic via UTC noon). */
export function laDateMinusDays(dateStr: string, n: number): string {
  return addDaysLA(dateStr, -n)
}

export interface PeriodSpec {
  currentDates: string[]              // LA YYYY-MM-DD list, ascending
  comparisonGroups: string[][]        // 4 same-shape groups for last 4 weeks
  hourCutoff: number | null           // hour past which the LAST current day has no data yet
  weekdayLabel: string
}

/**
 * Pure period→spec calculator. Pass `now` so the function is deterministic
 * and testable. Defaults to "now" (LA wall clock).
 */
export function derivePeriodSpec(
  period: HourlyComparisonPeriod,
  now?: { todayLA: string; currentLAHour: number }
): PeriodSpec {
  const today = now?.todayLA ?? todayInLA()
  const currentLAHour = now?.currentLAHour ?? getCurrentLAHour()
  const todayDow = new Date(today + "T12:00:00Z").getUTCDay()

  if (period === "today") {
    return {
      currentDates: [today],
      comparisonGroups: [7, 14, 21, 28].map((n) => [laDateMinusDays(today, n)]),
      hourCutoff: currentLAHour,
      weekdayLabel: DAY_NAMES[todayDow],
    }
  }

  if (period === "yesterday") {
    const yday = laDateMinusDays(today, 1)
    const ydayDow = new Date(yday + "T12:00:00Z").getUTCDay()
    return {
      currentDates: [yday],
      comparisonGroups: [7, 14, 21, 28].map((n) => [laDateMinusDays(yday, n)]),
      hourCutoff: null,
      weekdayLabel: DAY_NAMES[ydayDow],
    }
  }

  // ISO-ish: Monday is week start. dow=0(Sun) → 6 days since Monday.
  const daysSinceMonday = (todayDow + 6) % 7

  if (period === "this-week") {
    const monday = laDateMinusDays(today, daysSinceMonday)
    const currentDates = Array.from({ length: daysSinceMonday + 1 }, (_, i) =>
      laDateMinusDays(monday, -i)
    )
    const comparisonGroups = [1, 2, 3, 4].map((wk) =>
      currentDates.map((d) => laDateMinusDays(d, wk * 7))
    )
    return {
      currentDates,
      comparisonGroups,
      hourCutoff: currentLAHour,
      weekdayLabel:
        currentDates.length === 1
          ? DAY_NAMES[1]
          : `Mon–${DAY_NAMES[todayDow]}`,
    }
  }

  // last-week: previous full Mon–Sun.
  const lastMonday = laDateMinusDays(today, daysSinceMonday + 7)
  const currentDates = Array.from({ length: 7 }, (_, i) =>
    laDateMinusDays(lastMonday, -i)
  )
  const comparisonGroups = [1, 2, 3, 4].map((wk) =>
    currentDates.map((d) => laDateMinusDays(d, wk * 7))
  )
  return {
    currentDates,
    comparisonGroups,
    hourCutoff: null,
    weekdayLabel: "last week",
  }
}

/** Weekday of an LA date string, 0=Sun. */
function dowOf(dateStr: string): number {
  return new Date(dateStr + "T12:00:00Z").getUTCDay()
}

/**
 * How a set of current dates names itself in "vs avg ___".
 *
 * One day is its weekday ("Tue"), because the baseline is that same weekday.
 * A week or less spans its ends ("Tue–Mon"), matching the "Mon–Wed" shape
 * `this-week` already used. Longer spans just state their length — "vs avg
 * Jul 3–Aug 2" would claim a calendar comparison the baseline doesn't make.
 */
export function rangeWeekdayLabel(dates: string[]): string {
  if (dates.length === 0) return ""
  if (dates.length === 1) return DAY_NAMES[dowOf(dates[0])]
  if (dates.length <= 7) {
    return `${DAY_NAMES[dowOf(dates[0])]}–${DAY_NAMES[dowOf(dates[dates.length - 1])]}`
  }
  return `${dates.length} days`
}

/**
 * The `derivePeriodSpec` generalisation: any dashboard range → the same
 * weekday-aligned baseline the four fixed periods use.
 *
 * The baseline is the identical set of dates shifted back 1, 2, 3 and 4 weeks,
 * so every current day is compared against the same weekday — a Saturday is
 * never averaged against a Tuesday. The hour cutoff applies only when the
 * range's last day *is* today, which is what keeps a day in progress from
 * being measured against four complete days.
 */
export function deriveRangeSpec(
  range: DashboardRange,
  now?: { todayLA: string; currentLAHour: number }
): PeriodSpec {
  const today = now?.todayLA ?? todayInLA()
  const currentLAHour = now?.currentLAHour ?? getCurrentLAHour()
  const currentDates = resolveRangeDates(range, today)
  const lastDate = currentDates[currentDates.length - 1]

  return {
    currentDates,
    comparisonGroups: [1, 2, 3, 4].map((wk) =>
      currentDates.map((d) => laDateMinusDays(d, wk * 7))
    ),
    hourCutoff: lastDate === today ? currentLAHour : null,
    weekdayLabel: rangeWeekdayLabel(currentDates),
  }
}

/**
 * Average-ticket pace, derived from the two paces already computed rather than
 * bucketed separately: current $/order against baseline $/order, both under
 * whatever hour cutoff the spec applied. Null unless both sides have orders.
 */
export function avgTicketPacePct(
  cmp: OrderPatternsHourlyComparison | null | undefined
): number | null {
  if (!cmp || cmp.currentTotal <= 0 || cmp.baselineTotal <= 0) return null
  const current = cmp.salesCurrentTotal / cmp.currentTotal
  const baseline = cmp.salesBaselineTotal / cmp.baselineTotal
  if (!(baseline > 0)) return null
  return Math.round(((current - baseline) / baseline) * 1000) / 10
}

/** Aggregate row from OtterHourlySummary (or any hourly-bucketed source). */
export interface AggregateHourlyRow {
  date: string  // YYYY-MM-DD
  hour: number  // 0-23
  orderCount: number
  netSales: number
}

/**
 * Bucket aggregate per-hour rows into the `hourly` + `hourlyComparison`
 * shape consumed by the chart. Mirrors the logic that lived inside
 * `getHourlyOrderDistributionWithComparison`, but operates on already-aggregated
 * rows (orderCount/netSales) rather than per-order increments.
 */
export function bucketHourlyRows(args: {
  rows: AggregateHourlyRow[]
  spec: PeriodSpec
  period: HourlyComparisonPeriod
}): { hourly: HourlyOrderPoint[]; hourlyComparison: OrderPatternsHourlyComparison | null } {
  const { rows, spec, period } = args
  const hourly = emptyHourly()

  const allComparisonDates = spec.comparisonGroups.flat()
  const currentDateSet = new Set(spec.currentDates)
  const comparisonDateSet = new Set(allComparisonDates)
  const comparisonDateToGroup = new Map<string, number>()
  spec.comparisonGroups.forEach((group, gi) => {
    for (const d of group) comparisonDateToGroup.set(d, gi)
  })

  const currentByHour = Array.from({ length: 24 }, () => ({ count: 0, sales: 0 }))
  const comparisonByHour = Array.from({ length: 24 }, () => ({ count: 0, sales: 0 }))

  const groupTotals = spec.comparisonGroups.map(() => 0)
  const groupSalesTotals = spec.comparisonGroups.map(() => 0)
  let currentTotal = 0
  let currentSalesTotal = 0
  let lastDataHour: number | null = null

  const lastCurrentDate = spec.currentDates[spec.currentDates.length - 1]
  const comparisonLastDayPerGroup = spec.comparisonGroups.map(
    (group) => group[group.length - 1]
  )
  const isComparisonLastDay = (date: string): boolean =>
    comparisonLastDayPerGroup.includes(date)

  for (const row of rows) {
    const { date, hour, orderCount, netSales } = row
    if (hour < 0 || hour >= 24) continue

    if (currentDateSet.has(date)) {
      currentByHour[hour].count += orderCount
      currentByHour[hour].sales += netSales

      if (date === lastCurrentDate && orderCount > 0) {
        lastDataHour = lastDataHour == null ? hour : Math.max(lastDataHour, hour)
      }

      if (
        spec.hourCutoff == null ||
        date !== lastCurrentDate ||
        hour <= spec.hourCutoff
      ) {
        currentTotal += orderCount
        currentSalesTotal += netSales
      }
    } else if (comparisonDateSet.has(date)) {
      comparisonByHour[hour].count += orderCount
      comparisonByHour[hour].sales += netSales

      if (
        spec.hourCutoff == null ||
        !isComparisonLastDay(date) ||
        hour <= spec.hourCutoff
      ) {
        const gi = comparisonDateToGroup.get(date)
        if (gi != null) {
          groupTotals[gi] += orderCount
          groupSalesTotals[gi] += netSales
        }
      }
    }
  }

  const currentInstances = spec.currentDates.length
  const baselineInstances = allComparisonDates.length

  for (let h = 0; h < 24; h++) {
    hourly[h].orderCount =
      currentInstances > 0
        ? Math.round((currentByHour[h].count / currentInstances) * 10) / 10
        : 0
    hourly[h].totalSales =
      currentInstances > 0
        ? Math.round((currentByHour[h].sales / currentInstances) * 100) / 100
        : 0
    hourly[h].avgOrderCount =
      baselineInstances > 0
        ? Math.round((comparisonByHour[h].count / baselineInstances) * 10) / 10
        : 0
    hourly[h].avgTotalSales =
      baselineInstances > 0
        ? Math.round((comparisonByHour[h].sales / baselineInstances) * 100) / 100
        : 0
  }

  if (currentInstances === 1) {
    for (let h = 0; h < 24; h++) {
      hourly[h].orderCount = currentByHour[h].count
    }
  }

  // Average over the weeks that actually have data, not over all four slots.
  // Dividing by 4 when only 3 baseline weeks exist understated the baseline by
  // a quarter and inflated every pace figure by ~33% — the "▲ 69% vs avg Tue"
  // class of number. `baselineWeeks < 2` still suppresses the line entirely.
  const baselineWeeks = groupTotals.filter((t) => t > 0).length
  const baselineTotal =
    baselineWeeks > 0
      ? groupTotals.reduce((a, b) => a + b, 0) / baselineWeeks
      : 0
  const pacePct =
    baselineTotal > 0 ? ((currentTotal - baselineTotal) / baselineTotal) * 100 : null

  const salesBaselineWeeks = groupSalesTotals.filter((t) => t > 0).length
  const salesBaselineTotal =
    salesBaselineWeeks > 0
      ? groupSalesTotals.reduce((a, b) => a + b, 0) / salesBaselineWeeks
      : 0
  const salesPacePct =
    salesBaselineTotal > 0
      ? ((currentSalesTotal - salesBaselineTotal) / salesBaselineTotal) * 100
      : null

  return {
    hourly,
    hourlyComparison: {
      period,
      currentTotal,
      baselineTotal: Math.round(baselineTotal * 10) / 10,
      pacePct: pacePct == null ? null : Math.round(pacePct * 10) / 10,
      baselineWeeks,
      weekdayLabel: spec.weekdayLabel,
      salesCurrentTotal: Math.round(currentSalesTotal * 100) / 100,
      salesBaselineTotal: Math.round(salesBaselineTotal * 100) / 100,
      salesPacePct:
        salesPacePct == null ? null : Math.round(salesPacePct * 10) / 10,
      lastDataHour,
      inProgress: spec.hourCutoff != null,
      // The per-week totals behind `baselineTotal`, kept rather than collapsed:
      // the overview's bullet tracks need the spread of the four baseline
      // weekdays, not just their mean. Empty weeks are dropped here so a
      // missing week can't drag a band's floor to zero.
      groupTotals: groupTotals.filter((t) => t > 0).map((t) => Math.round(t * 10) / 10),
      groupSalesTotals: groupSalesTotals
        .filter((t) => t > 0)
        .map((t) => Math.round(t * 100) / 100),
    },
  }
}
