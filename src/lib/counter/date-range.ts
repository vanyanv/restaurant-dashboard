import {
  addDays, differenceInCalendarDays, startOfDay, startOfWeek, startOfMonth,
  startOfQuarter, startOfYear,
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

/**
 * Normalises `today` to a local midnight ONCE, here, rather than trusting
 * every preset's `resolve` to do it. The module's contract says "all dates
 * are local midnights", but a caller passes `new Date()` — a `Date` with
 * whatever time-of-day it was constructed at — and every preset built on it
 * (`today`, `yesterday`, every trailing window) passed that time-of-day
 * through unchanged. A `d7` resolved at 14:32 returned `Tue 14:32 .. Mon
 * 14:32` instead of two midnights; any query using `end` as an inclusive
 * bound then silently dropped the rest of that day.
 */
export function resolvePreset(id: PresetId, today: Date): DateRange {
  const p = PRESETS.find((x) => x.id === id)
  if (!p) throw new Error(`unknown preset: ${id}`)
  return p.resolve(startOfDay(today))
}

/** Inclusive of both ends — a single day is 1, not 0. */
export function dayCount(r: DateRange): number {
  return differenceInCalendarDays(r.end, r.start) + 1
}

/**
 * `src/app/actions/_shared/date-range.ts` ALREADY exports a DIFFERENT
 * `DateRange` — `{ startDate, endDate }`, with `endDate` at 23:59:59 local,
 * built for existing Prisma queries that treat it as an inclusive bound.
 * Counter's `DateRange` here is `{ start, end }` at local midnight. The two
 * are not interchangeable: an adapter that hands Counter's `end` straight
 * into one of those existing queries silently drops the last day of every
 * range (a query filtering `< endDate` excludes all of `end`'s calendar day
 * when `endDate` is that day's midnight).
 *
 * `toQueryBounds` is the one place that conversion happens, so an adapter
 * never has to reconstruct "add 23:59:59 to the end date" itself.
 */
export function toQueryBounds(r: DateRange): { startDate: Date; endDate: Date } {
  const endDate = new Date(
    r.end.getFullYear(),
    r.end.getMonth(),
    r.end.getDate(),
    23, 59, 59,
  )
  return { startDate: r.start, endDate }
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
  // R4: NOT `subYears` — that lands on the same CALENDAR date a year back,
  // which is a shifted WEEKDAY in most years (verified: Tue 18 Aug .. Mon 24
  // Aug 2026 becomes Mon 18 Aug .. Sun 24 Aug 2025 under subYears), comparing
  // a Mon–Sun trading week against a Sun–Sat one. A restaurant's week has a
  // strong shape (weekend vs. weekday volume), so that's a structural
  // distortion, not a rounding detail. A 364-day offset — exactly 52 weeks —
  // preserves weekday alignment instead: every day in the comparison range
  // falls on the same weekday as its counterpart in `r`.
  if (mode === "year") return { start: addDays(r.start, -364), end: addDays(r.end, -364) }
  if (mode === "prev") {
    const span = dayCount(r)
    return { start: addDays(r.start, -span), end: addDays(r.end, -span) }
  }
  // weekday: NOT a same-length prior period. It returns a window that
  // CONTAINS the four preceding occurrences of the period being compared —
  // the four same-weekdays before a single day, or the four preceding weeks
  // before a 7-day range — and a caller is expected to aggregate across that
  // window (e.g. average it), not treat it as one equivalent period. That
  // window is span + 21 days for any input, which is only a coherent "4
  // preceding occurrences" concept up to a week (1..7 days: 4 same-weekdays
  // through 4 same-weeks). Past a week it stops meaning anything — a 30-day
  // range would return a 51-day window that isn't 4 of anything — so this
  // returns null past 7 days rather than a plausible-looking range that
  // answers no question. The date control should offer "prev" or "year"
  // instead for longer ranges.
  const span = dayCount(r)
  if (span > 7) return null
  return { start: addDays(r.start, -28), end: addDays(r.end, -7) }
}

/**
 * A named preset, or an arbitrary window the reader chose.
 *
 * "custom" is not a thirteenth preset — it has no `resolve`, because it does
 * not resolve against today at all. It is the range that is already in the
 * URL. Note 53's eight pressable weeks and the date control's own steppers
 * both produce one.
 */
export type RangeId = PresetId | "custom"

/**
 * A calendar date as `YYYY-MM-DD`, read off the LOCAL fields.
 *
 * `toISOString().slice(0, 10)` is the obvious version and it is wrong here:
 * this module's dates are local midnights and times-of-day, and converting
 * to UTC shifts the calendar date whenever the local offset crosses a
 * midnight — BACKWARDS a day east of UTC, FORWARDS a day west of UTC,
 * depending on the local offset and time of day. A range written to the URL
 * and read back would drift by a day on the round trip, in one direction or
 * the other depending where the server or reader's clock sits.
 */
export function isoDay(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${d.getFullYear()}-${m}-${day}`
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * The inverse, treating the string as UNTRUSTED — it arrives from a query
 * string a reader can hand-edit. Anything that is not a real calendar date at
 * local midnight returns null, and the caller falls back to a preset.
 *
 * The round-trip check catches overflow that `new Date(y, m, d)` accepts
 * silently: February 30th becomes March 2nd rather than an error.
 */
export function parseIsoDay(s: string): Date | null {
  const m = ISO_DAY.exec(s)
  if (!m) return null
  const [, y, mo, d] = m
  const date = new Date(Number(y), Number(mo) - 1, Number(d))
  return isoDay(date) === s ? date : null
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** `Aug 3`, or `Dec 29, 2025` when the range straddles a year boundary. */
function dayLabel(d: Date, withYear: boolean): string {
  const base = `${MONTHS[d.getMonth()]} ${d.getDate()}`
  return withYear ? `${base}, ${d.getFullYear()}` : base
}

/**
 * One calendar day, written the way every other date on a Counter page is
 * written — `Aug 3, 2026`. Exported so a card that prints a store's opening
 * date does not grow a second date vocabulary beside this one (note 60's
 * defect class: two functions, one question, two answers).
 */
export function shortDate(d: Date): string {
  return dayLabel(d, true)
}

/**
 * What the date control prints, and what the Ask context sentence says.
 *
 * A custom range has no name of its own, so it is named by its ends. Before
 * this existed, `PRESETS.find(...) ?? PRESETS[0]` in `date-control.tsx`
 * silently labelled anything unrecognised **"Today"** — a range that says one
 * thing and shows another, which is note 19's lie in its purest form.
 */
export function rangeLabel(r: DateRange, id: RangeId): string {
  if (id !== "custom") return PRESETS.find((p) => p.id === id)?.name ?? "Custom"
  const spansYears = r.start.getFullYear() !== r.end.getFullYear()
  if (r.start.getTime() === r.end.getTime()) return dayLabel(r.start, spansYears)
  return `${dayLabel(r.start, spansYears)} – ${dayLabel(r.end, spansYears)}`
}

const WEEKDAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
]

/**
 * The page head's TITLE — "7 days to Aug 21", or "Tuesday's numbers" for a
 * single day.
 *
 * The prototype's `P.<page>.title()` is a function of the RANGE, not the page's
 * name (line 4217): "Overview" is what the breadcrumb calls this page, and a
 * title that repeats it tells a reader nothing they did not already know from
 * the lit rail item. What they do not know, and what every figure below is a
 * claim about, is the window.
 *
 * Lives here, beside `rangeLabel`, because every Counter page's head will want
 * it and a second copy is a second answer to the same question.
 */
export function rangeTitle(r: DateRange): string {
  const n = dayCount(r)
  if (n === 1) return `${WEEKDAYS[r.end.getDay()]}'s numbers`
  return `${n} days to ${MONTHS[r.end.getMonth()]} ${r.end.getDate()}`
}

/**
 * The page head's SUBTITLE — the prototype's `R.head()` (line 3651):
 * "Hollywood · Aug 15 – 21 · vs the same 4 weekdays".
 *
 * Three facts, in the order a reader needs them: WHICH store, WHICH window,
 * WHAT it is measured against. `.pagehead .sub` uppercases it, so the caller
 * writes it in sentence case.
 */
export function rangeSubtitle(
  storeName: string,
  r: DateRange,
  comparisonId: ComparisonId,
): string {
  const cmp = COMPARISONS.find((c) => c.id === comparisonId)
  const window = rangeLabel(r, "custom")
  return cmp ? `${storeName} · ${window} · ${cmp.label}` : `${storeName} · ${window}`
}
