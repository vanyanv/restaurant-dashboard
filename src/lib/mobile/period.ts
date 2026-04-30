import { todayInLA, startOfDayLA, endOfDayLA, localDateStr } from "@/lib/dashboard-utils"
import type { HourlyComparisonPeriod } from "@/types/analytics"

export type MobileNamedPeriod = "today" | "yesterday" | "this-week" | "last-week"
export type MobilePeriod = MobileNamedPeriod | "custom"

export const MOBILE_PERIODS: Array<{ value: MobileNamedPeriod; label: string; short: string }> = [
  { value: "today", label: "Today", short: "TODAY" },
  { value: "yesterday", label: "Yesterday", short: "YEST" },
  { value: "this-week", label: "This week", short: "WK" },
  { value: "last-week", label: "Last week", short: "LAST WK" },
]

const NAMED_VALUES = new Set<MobileNamedPeriod>(MOBILE_PERIODS.map((p) => p.value))

/** Max custom range we'll honor before falling back to default. */
export const MAX_CUSTOM_RANGE_DAYS = 365

export type MobileRange =
  | { kind: "named"; period: MobileNamedPeriod }
  | { kind: "custom"; start: Date; end: Date; startStr: string; endStr: string }

/**
 * Read `?period=…&start=…&end=…` from a Next.js page's searchParams.
 * Falls back to "today" for invalid combos (bad ISO, end<start, range too long).
 */
export function parseMobileRange(sp: {
  period?: string
  start?: string
  end?: string
}): MobileRange {
  const raw = sp.period
  if (raw === "custom") {
    const custom = parseCustomRange(sp.start, sp.end)
    if (custom) return custom
    // Invalid custom → silent fallback.
    return { kind: "named", period: "today" }
  }
  if (raw && NAMED_VALUES.has(raw as MobileNamedPeriod)) {
    return { kind: "named", period: raw as MobileNamedPeriod }
  }
  return { kind: "named", period: "today" }
}

/** Back-compat: old callers that just want a named period. Returns "today" for "custom". */
export function parsePeriod(raw: string | undefined | null): MobileNamedPeriod {
  if (raw && NAMED_VALUES.has(raw as MobileNamedPeriod)) return raw as MobileNamedPeriod
  return "today"
}

/** Mobile period maps 1:1 to the hourly-pattern enum on the analytics action.
 *  Custom currently isn't supported by that action, so callers must guard. */
export function toHourlyPeriod(p: MobileNamedPeriod): HourlyComparisonPeriod {
  return p
}

function isValidIsoDate(s: string | undefined): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(s + "T00:00:00.000Z")
  return !Number.isNaN(d.getTime())
}

function parseCustomRange(
  startStr: string | undefined,
  endStr: string | undefined,
): Extract<MobileRange, { kind: "custom" }> | null {
  if (!isValidIsoDate(startStr) || !isValidIsoDate(endStr)) return null
  const start = startOfDayLA(startStr)
  const end = endOfDayLA(endStr)
  if (end.getTime() < start.getTime()) return null
  const days = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000))
  if (days > MAX_CUSTOM_RANGE_DAYS) return null
  return { kind: "custom", start, end, startStr, endStr }
}

/**
 * Resolve a mobile period into a concrete date range in LA local time.
 * Weeks are Sunday-anchored (matches the dashboard's existing convention).
 */
export function periodToDateRange(p: MobileNamedPeriod): {
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
export function periodDateStrings(p: MobileNamedPeriod): string[] {
  const { startDate, endDate } = periodToDateRange(p)
  const out: string[] = []
  const d = new Date(startDate)
  while (d <= endDate) {
    out.push(d.toISOString().slice(0, 10))
    d.setDate(d.getDate() + 1)
  }
  return out
}

/** Inclusive day count between two LA-local Dates. */
export function rangeDayCount(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1
}

/** Format a custom range as "MAR 5 → APR 20" (caps, em-arrow) for the active pill. */
export function formatCustomRangeShort(start: Date, end: Date): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })
  return `${fmt.format(start).toUpperCase()} → ${fmt.format(end).toUpperCase()}`
}

/** Format a custom range as "MAR 5 — APR 20 · 47 DAYS" for the sheet readout. */
export function formatCustomRangeLong(start: Date, end: Date): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })
  const days = rangeDayCount(start, end)
  return `${fmt.format(start).toUpperCase()} — ${fmt.format(end).toUpperCase()} · ${days} DAY${days === 1 ? "" : "S"}`
}

export { localDateStr }
