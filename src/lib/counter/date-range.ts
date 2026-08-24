import {
  addDays, differenceInCalendarDays, startOfWeek, startOfMonth,
  startOfQuarter, startOfYear, subYears,
} from "date-fns"

/**
 * The logic under the most-used control in the product.
 *
 * Note 19: "A range that only changes the label is a lie." Picking a range has
 * to regenerate the series, the totals, the bucket size and the tooltips — so
 * everything a caller needs to do that lives here, and nothing here renders.
 *
 * All dates are local midnights. The dashboard's day boundary is the
 * restaurant's, not UTC's, and every existing query in this codebase already
 * works that way.
 */

export interface DateRange {
  start: Date
  end: Date
}

export type PresetId =
  | "today" | "yesterday" | "wtd" | "lastweek"
  | "d3" | "d7" | "d14" | "d30" | "d90"
  | "mtd" | "qtd" | "ytd"

export interface Preset {
  id: PresetId
  name: string
  resolve: (today: Date) => DateRange
}

/** Monday. The trade runs on a Monday-start week (note 53: weekly is the cadence). */
const weekStart = (d: Date) => startOfWeek(d, { weekStartsOn: 1 })

/** A trailing window that INCLUDES today, so "last 7 days" is 7 days. */
const trailing = (n: number) => (today: Date): DateRange => ({
  start: addDays(today, -(n - 1)),
  end: today,
})

export const PRESETS: readonly Preset[] = [
  { id: "today", name: "Today", resolve: (t) => ({ start: t, end: t }) },
  { id: "yesterday", name: "Yesterday", resolve: (t) => ({ start: addDays(t, -1), end: addDays(t, -1) }) },
  { id: "wtd", name: "This week", resolve: (t) => ({ start: weekStart(t), end: t }) },
  {
    id: "lastweek",
    name: "Last week",
    resolve: (t) => {
      const s = addDays(weekStart(t), -7)
      return { start: s, end: addDays(s, 6) }
    },
  },
  { id: "d3", name: "Last 3 days", resolve: trailing(3) },
  { id: "d7", name: "Last 7 days", resolve: trailing(7) },
  { id: "d14", name: "Last 14 days", resolve: trailing(14) },
  { id: "d30", name: "Last 30 days", resolve: trailing(30) },
  { id: "d90", name: "Last 90 days", resolve: trailing(90) },
  { id: "mtd", name: "Month-to-date", resolve: (t) => ({ start: startOfMonth(t), end: t }) },
  { id: "qtd", name: "Quarter-to-date", resolve: (t) => ({ start: startOfQuarter(t), end: t }) },
  { id: "ytd", name: "Year-to-date", resolve: (t) => ({ start: startOfYear(t), end: t }) },
] as const

export function resolvePreset(id: PresetId, today: Date): DateRange {
  const p = PRESETS.find((x) => x.id === id)
  if (!p) throw new Error(`unknown preset: ${id}`)
  return p.resolve(today)
}

/** Inclusive of both ends — a single day is 1, not 0. */
export function dayCount(r: DateRange): number {
  return differenceInCalendarDays(r.end, r.start) + 1
}

export type Bucket = "day" | "week" | "month"

/**
 * Buckets follow the span, so a chart never draws 365 columns or 2 of them.
 * Days up to a month, weeks up to four months, months beyond.
 */
export function bucketFor(r: DateRange): Bucket {
  const days = dayCount(r)
  if (days <= 31) return "day"
  if (days <= 123) return "week"
  return "month"
}

/**
 * Walk by exactly the range you are on, not by a calendar unit. A 7-day range
 * steps 7 days; a 90-day range steps 90. Stepping a "last 30 days" window by a
 * month would silently change its length.
 */
export function stepRange(r: DateRange, direction: -1 | 1): DateRange {
  const span = dayCount(r)
  return {
    start: addDays(r.start, span * direction),
    end: addDays(r.end, span * direction),
  }
}

export type ComparisonId = "prev" | "weekday" | "year" | "none"

export interface Comparison {
  id: ComparisonId
  name: string
  /** Reads inside a sentence: "…$7,468, vs the prior period." */
  label: string
  /** Reads inside a chart tooltip, where space is short. */
  short: string
}

export const COMPARISONS: readonly Comparison[] = [
  { id: "prev", name: "Prior period", label: "vs the prior period", short: "vs prior" },
  { id: "weekday", name: "4 same weekdays", label: "vs the same 4 weekdays", short: "vs 4 weekdays" },
  { id: "year", name: "Last year", label: "vs the same days last year", short: "vs last year" },
  { id: "none", name: "None", label: "with no comparison", short: "no compare" },
] as const

/**
 * The comparison is part of the range, not a separate setting (spec §5.3), so
 * it is derived from the range rather than stored beside it.
 *
 * `none` returns null on purpose: a caller must then decide what to render
 * instead of a delta, rather than being handed a range that quietly equals the
 * primary one.
 */
export function comparisonRange(r: DateRange, mode: ComparisonId): DateRange | null {
  if (mode === "none") return null
  if (mode === "year") return { start: subYears(r.start, 1), end: subYears(r.end, 1) }
  if (mode === "prev") {
    const span = dayCount(r)
    return { start: addDays(r.start, -span), end: addDays(r.end, -span) }
  }
  // weekday: the same span, four weeks earlier through one week earlier —
  // a like-for-like read for a trade whose week has a strong shape.
  return { start: addDays(r.start, -28), end: addDays(r.end, -7) }
}
