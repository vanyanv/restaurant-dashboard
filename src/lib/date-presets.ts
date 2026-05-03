import { endOfMonth, startOfMonth, startOfWeek } from "date-fns"

export interface DateRange {
  start: Date
  end: Date
}

const SUNDAY = 0 as const

function startOfDay(d: Date): Date {
  const n = new Date(d)
  n.setHours(0, 0, 0, 0)
  return n
}

/** Sunday of `now`'s week → today (clamped). Matches Otter's Sun→Sat reporting boundary. */
export function thisWeekRange(now: Date = new Date()): DateRange {
  const today = startOfDay(now)
  return { start: startOfWeek(today, { weekStartsOn: SUNDAY }), end: today }
}

/** Previous Sunday → previous Saturday (full 7-day range, all in the past). */
export function lastWeekRange(now: Date = new Date()): DateRange {
  const today = startOfDay(now)
  const thisSunday = startOfWeek(today, { weekStartsOn: SUNDAY })
  const start = new Date(thisSunday)
  start.setDate(start.getDate() - 7)
  const end = new Date(thisSunday)
  end.setDate(end.getDate() - 1)
  return { start, end }
}

/** First of `now`'s month → today (clamped). */
export function thisMonthRange(now: Date = new Date()): DateRange {
  const today = startOfDay(now)
  return { start: startOfMonth(today), end: today }
}

/** First → last day of the previous month. */
export function lastMonthRange(now: Date = new Date()): DateRange {
  const today = startOfDay(now)
  const start = startOfMonth(new Date(today.getFullYear(), today.getMonth() - 1, 1))
  return { start, end: endOfMonth(start) }
}
