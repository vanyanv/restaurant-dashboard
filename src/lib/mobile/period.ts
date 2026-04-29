import { todayInLA, startOfDayLA, endOfDayLA } from "@/lib/dashboard-utils"
import type { HourlyComparisonPeriod } from "@/types/analytics"

export type MobilePeriod = "today" | "yesterday" | "this-week" | "last-week"

export const MOBILE_PERIODS: Array<{ value: MobilePeriod; label: string; short: string }> = [
  { value: "today", label: "Today", short: "TODAY" },
  { value: "yesterday", label: "Yesterday", short: "YEST" },
  { value: "this-week", label: "This week", short: "WK" },
  { value: "last-week", label: "Last week", short: "LAST WK" },
]

const PERIOD_VALUES = new Set<MobilePeriod>(MOBILE_PERIODS.map((p) => p.value))

export function parsePeriod(raw: string | undefined | null): MobilePeriod {
  if (raw && PERIOD_VALUES.has(raw as MobilePeriod)) return raw as MobilePeriod
  return "today"
}

/** Mobile period maps 1:1 to the hourly-pattern enum on the analytics action. */
export function toHourlyPeriod(p: MobilePeriod): HourlyComparisonPeriod {
  return p
}

/**
 * Resolve a mobile period into a concrete date range in LA local time.
 * Weeks are Sunday-anchored (matches the dashboard's existing convention).
 */
export function periodToDateRange(p: MobilePeriod): {
  startDate: Date
  endDate: Date
  /** Number of LA-local days in the window (inclusive). */
  dayCount: number
} {
  const today = todayInLA()
  const todayStart = startOfDayLA(today)

  if (p === "today") {
    return { startDate: todayStart, endDate: endOfDayLA(today), dayCount: 1 }
  }
  if (p === "yesterday") {
    const y = new Date(todayStart)
    y.setDate(y.getDate() - 1)
    return {
      startDate: y,
      endDate: new Date(y.getTime() + 24 * 60 * 60 * 1000 - 1),
      dayCount: 1,
    }
  }
  // This week / last week, Sunday-anchored. getUTCDay because startOfDayLA
  // returns a Date pinned to UTC midnight on the LA-local day, so getUTCDay
  // is the right way to read the LA-local weekday.
  const dayOfWeek = todayStart.getUTCDay()
  const weekStart = new Date(todayStart)
  weekStart.setDate(weekStart.getDate() - dayOfWeek)

  if (p === "this-week") {
    return {
      startDate: weekStart,
      endDate: endOfDayLA(today),
      dayCount: dayOfWeek + 1,
    }
  }
  // last-week
  const lastWeekStart = new Date(weekStart)
  lastWeekStart.setDate(lastWeekStart.getDate() - 7)
  const lastWeekEnd = new Date(weekStart)
  lastWeekEnd.setDate(lastWeekEnd.getDate() - 1)
  lastWeekEnd.setUTCHours(23, 59, 59, 999)
  return {
    startDate: lastWeekStart,
    endDate: lastWeekEnd,
    dayCount: 7,
  }
}

/** YYYY-MM-DD strings for every LA-local day in the window (inclusive). */
export function periodDateStrings(p: MobilePeriod): string[] {
  const { startDate, endDate } = periodToDateRange(p)
  const out: string[] = []
  const d = new Date(startDate)
  while (d <= endDate) {
    out.push(d.toISOString().slice(0, 10))
    d.setDate(d.getDate() + 1)
  }
  return out
}
