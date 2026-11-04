import {
  addDays, addMonths, differenceInCalendarDays, isSameDay, startOfDay,
  startOfWeek, startOfMonth, startOfQuarter, startOfYear,
} from "date-fns"

/**
 * The logic under the most-used control in the product.
 *
 * Note 19: "A range that only changes the label is a lie." Picking a range has
 * to regenerate the series, the totals, the bucket size and the tooltips — so
 * everything a caller needs to do that lives here, and nothing here renders.
 *
 * Ranges are date-only values represented by local fields for date-fns.
 * readCounterParams converts the current instant to the Los Angeles business
 * date before calling these calendar helpers. Do not timezone-convert an
 * already selected calendar date. Serialize dates as day keys across Flight.
 */

export interface DateRange {
  start: Date
  end: Date
}

export type PresetId =
  | "today" | "yesterday" | "wtd" | "lastweek"
  | "d3" | "d7" | "d14" | "d30" | "d90"
  | "mtd" | "lastmonth" | "qtd" | "ytd"

/** The heading a preset sits under in the date control's menu. */
export type PresetGroup = "Days" | "Weeks" | "Months" | "Longer"

export interface Preset {
  id: PresetId
  name: string
  resolve: (today: Date) => DateRange
  group: PresetGroup
  /**
   * False for a preset that still resolves (an old link carries it in
   * `?range=`) but is no longer offered: `d3`, `d14` and `qtd` were rarely
   * picked and made the menu twelve rows long.
   */
  menu: boolean
}

/** Monday. The trade runs on a Monday-start week (note 53: weekly is the cadence). */
const weekStart = (d: Date) => startOfWeek(d, { weekStartsOn: 1 })

/**
 * The last day of `d`'s month at local MIDNIGHT. Not date-fns `endOfMonth`,
 * which returns 23:59:59.999 and breaks this module's "all dates are local
 * midnights" contract the moment it is used as a range end.
 */
const lastDayOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0)

/** A trailing window that INCLUDES today, so "last 7 days" is 7 days. */
const trailing = (n: number) => (today: Date): DateRange => ({
  start: addDays(today, -(n - 1)),
  end: today,
})

export const PRESETS: readonly Preset[] = [
  { id: "today", name: "Today", group: "Days", menu: true, resolve: (t) => ({ start: t, end: t }) },
  {
    id: "yesterday", name: "Yesterday", group: "Days", menu: true,
    resolve: (t) => ({ start: addDays(t, -1), end: addDays(t, -1) }),
  },
  { id: "wtd", name: "This week", group: "Weeks", menu: true, resolve: (t) => ({ start: weekStart(t), end: t }) },
  {
    id: "lastweek",
    name: "Last week",
    group: "Weeks",
    menu: true,
    resolve: (t) => {
      const s = addDays(weekStart(t), -7)
      return { start: s, end: addDays(s, 6) }
    },
  },
  { id: "d7", name: "Last 7 days", group: "Weeks", menu: true, resolve: trailing(7) },
  { id: "mtd", name: "This month", group: "Months", menu: true, resolve: (t) => ({ start: startOfMonth(t), end: t }) },
  {
    id: "lastmonth", name: "Last month", group: "Months", menu: true,
    resolve: (t) => {
      const s = startOfMonth(addMonths(t, -1))
      return { start: s, end: lastDayOfMonth(s) }
    },
  },
  { id: "d30", name: "Last 30 days", group: "Months", menu: true, resolve: trailing(30) },
  { id: "d90", name: "Last 90 days", group: "Longer", menu: true, resolve: trailing(90) },
  { id: "ytd", name: "This year", group: "Longer", menu: true, resolve: (t) => ({ start: startOfYear(t), end: t }) },
  { id: "d3", name: "Last 3 days", group: "Days", menu: false, resolve: trailing(3) },
  { id: "d14", name: "Last 14 days", group: "Weeks", menu: false, resolve: trailing(14) },
  { id: "qtd", name: "This quarter", group: "Longer", menu: false, resolve: (t) => ({ start: startOfQuarter(t), end: t }) },
] as const

/** What the date control offers, in menu order. Old ids still resolve. */
export const MENU_PRESETS: readonly Preset[] = PRESETS.filter((p) => p.menu)

export const PRESET_GROUPS: readonly PresetGroup[] = ["Days", "Weeks", "Months", "Longer"]

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
 * Pre-Counter actions in this layer (e.g. `store/pnl-actions.ts`,
 * `splh-actions.ts`) use a DIFFERENT `DateRange` shape — `{ startDate,
 * endDate }`, with `endDate` at 23:59:59 local, built for existing Prisma
 * queries that treat it as an inclusive bound.
 * Counter's `DateRange` here is `{ start, end }` at local midnight. The two
 * are not interchangeable: an adapter that hands Counter's `end` straight
 * into one of those existing queries silently drops the last day of every
 * range (a query filtering `< endDate` excludes all of `end`'s calendar day
 * when `endDate` is that day's midnight).
 *
 * `toQueryBounds` is the one place that conversion happens, so an adapter
 * never has to reconstruct "add 23:59:59 to the end date" itself. It converts
 * FRAMES as well as times: `r.start`/`r.end` are local-midnight instants —
 * correct for a reader's calendar, wrong for a database column — so the
 * calendar day is read off with local getters and then rebuilt as a UTC
 * instant, which is the frame every caller actually queries against. All six
 * callers (`channel-mix`, `service-profile`, `statement`, and three sites
 * across the two adapters) filter either a Postgres `@db.Date` column (stored
 * at UTC midnight) or `OtterOrder.referenceTimeLocal` (local time encoded AS a
 * UTC epoch) — UTC-anchored bounds are the right frame for every one of them.
 *
 * This belongs here, at the query boundary, and not in `resolvePreset`:
 * the module's contract is "all dates are local midnights", and `rangeLabel`,
 * `rangeTitle`, `dayCount`, every preset and every reader-facing string is
 * built on that contract holding all the way through the module. Converting
 * earlier would break it for everything that isn't a query. `toQueryBounds`
 * is the one function whose whole job is to hand a local calendar day to a
 * database, so it is the one place the frame is allowed to change.
 *
 * Under `TZ=UTC` this is a no-op: local midnight and UTC midnight are the
 * same instant, so the same Y/M/D goes in and the same instant comes back
 * out. Production runs on Vercel under UTC, so this fixes local dev (and any
 * non-UTC deployment) without changing production's output. The bug this
 * fixes only shows up off UTC: `buildPeriods` (fixed separately, in
 * `buildPeriods`'s own commit) floors its cursor with `startOfDayUTC`, so a
 * bound that was still carrying a local-time offset landed on the wrong side
 * of a UTC day boundary and produced one extra period — a 7-day range walked
 * as 8 days and queried 8 days of rows.
 */
export function toQueryBounds(r: DateRange): { startDate: Date; endDate: Date } {
  const startDate = new Date(
    Date.UTC(r.start.getFullYear(), r.start.getMonth(), r.start.getDate()),
  )
  const endDate = new Date(
    Date.UTC(r.end.getFullYear(), r.end.getMonth(), r.end.getDate(), 23, 59, 59),
  )
  return { startDate, endDate }
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

/** A Monday-start week: all seven days, or Monday up to `today` while it runs. */
function isWeekShaped(r: DateRange, today?: Date): boolean {
  if (r.start.getTime() !== weekStart(r.start).getTime()) return false
  const span = dayCount(r)
  if (span === 7) return true
  return span < 7 && today !== undefined && isSameDay(r.end, today)
}

/** A calendar month: the 1st to its last day, or the 1st up to `today`. */
function isMonthShaped(r: DateRange, today?: Date): boolean {
  if (r.start.getDate() !== 1) return false
  if (r.start.getMonth() !== r.end.getMonth() || r.start.getFullYear() !== r.end.getFullYear()) return false
  if (isSameDay(r.end, lastDayOfMonth(r.start))) return true
  return dayCount(r) > 1 && today !== undefined && isSameDay(r.end, today)
}

/**
 * The ‹ › arrows. Walk by the calendar unit the range IS, so a week stays a
 * week and a month stays a month:
 *
 *   - one day        → the day before / after
 *   - a Monday week  → the whole week before / after (Mon–Sun). "This week"
 *                      on a Tuesday is Mon–Tue; ‹ goes to all of last week,
 *                      not to the Saturday and Sunday before it, which is
 *                      what stepping by its two-day span used to do.
 *   - a month        → the whole month before / after
 *   - anything else  → by its own length, so "last 30 days" stays 30 days
 *
 * `today`, when given, keeps a step from running into the future: a window
 * that would end after today ends today, and one that would start after
 * today becomes today itself. `canStepForward` is how a caller disables ›.
 */
export function stepRange(r: DateRange, direction: -1 | 1, today?: Date): DateRange {
  const span = dayCount(r)
  let next: DateRange
  if (span === 1) {
    next = { start: addDays(r.start, direction), end: addDays(r.start, direction) }
  } else if (isWeekShaped(r, today)) {
    const start = addDays(r.start, 7 * direction)
    next = { start, end: addDays(start, 6) }
  } else if (isMonthShaped(r, today)) {
    const start = addMonths(r.start, direction)
    next = { start, end: lastDayOfMonth(start) }
  } else {
    next = { start: addDays(r.start, span * direction), end: addDays(r.end, span * direction) }
  }
  if (today !== undefined && next.end.getTime() > today.getTime()) {
    next = { start: next.start, end: today }
    if (next.start.getTime() > today.getTime()) next = { start: today, end: today }
  }
  return next
}

/** False when the window already reaches today, so › has nowhere to go. */
export function canStepForward(r: DateRange, today: Date): boolean {
  return r.end.getTime() < startOfDay(today).getTime()
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
    // Weekday for weekday. Anything shorter than a week is compared with the
    // same days one week earlier: "This week" on a Tuesday is Mon–Tue, and
    // the days immediately before it are a Saturday and a Sunday, which made
    // an ordinary week read as a collapse. A single day the same way: Monday
    // against last Monday, not against Sunday.
    const span = dayCount(r)
    if (span < 7) return { start: addDays(r.start, -7), end: addDays(r.end, -7) }
    // A calendar month (whole, or the 1st up to some day) against the same
    // days of the month before, clipped to that month's length.
    if (r.start.getDate() === 1 && r.start.getMonth() === r.end.getMonth()
      && r.start.getFullYear() === r.end.getFullYear()) {
      const start = addMonths(r.start, -1)
      const last = lastDayOfMonth(start)
      const sameDay = new Date(start.getFullYear(), start.getMonth(), r.end.getDate())
      const end = isSameDay(r.end, lastDayOfMonth(r.start)) || sameDay > last ? last : sameDay
      return { start, end }
    }
    return { start: addDays(r.start, -span), end: addDays(r.end, -span) }
  }
  // weekday: the CONTIGUOUS HULL of the four windows `comparisonWindows`
  // returns — `[start-28, end-7]`, which is `span + 21` days for any input.
  //
  // This is a span to shade and a span to bound a query by, NOT a figure to
  // read. Only at span 7 does the hull equal the four occurrences laid end to
  // end; below that it holds the unrelated days between them (22 days for a
  // single day, 24 for three), so anything that sums it and divides by four is
  // answering a different question by a factor of (span + 21) / (4 × span).
  // `loadComparisonStatement` loads the four windows themselves. See
  // `comparisonWindows`.
  //
  // Null past a week, because "4 preceding occurrences" stops meaning anything
  // there — a 30-day range has no fourth preceding 30 days inside 51 — and the
  // date control offers "prev" or "year" instead.
  const span = dayCount(r)
  if (span > 7) return null
  return { start: addDays(r.start, -28), end: addDays(r.end, -7) }
}

/**
 * The windows a comparison actually MEASURES: one for `prev` and `year`, four
 * for `weekday`.
 *
 * `comparisonRange` returns one contiguous span, which is what a calendar
 * shades and what bounds a query. For `weekday` that span is the hull of four
 * separate windows, and the days between them belong to nobody: a Saturday
 * compared against "the same 4 weekdays" has a 22-day hull holding four
 * Saturdays and eighteen other days. Every caller loaded the hull as one
 * window and divided its money by four — so a single day was read against five
 * and a half days of trade, and the default range (`yesterday`) printed a
 * collapse that never happened. Only a 7-day range came out right, because
 * there and only there the hull tiles exactly into four.
 *
 * Each window here is the SAME LENGTH as `r` and lands on the same weekdays,
 * so four of them are four comparable periods and `ComparisonContext.divisor`
 * is finally the number it says it is. Oldest first.
 */
export function comparisonWindows(r: DateRange, mode: ComparisonId): DateRange[] | null {
  if (mode !== "weekday") {
    const one = comparisonRange(r, mode)
    return one === null ? null : [one]
  }
  if (comparisonRange(r, "weekday") === null) return null
  return [4, 3, 2, 1].map((weeksBack) => ({
    start: addDays(r.start, -7 * weeksBack),
    end: addDays(r.end, -7 * weeksBack),
  }))
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
 *
 * `days` inserts the prototype's FOURTH term, between the window and the
 * comparison — `P.pnl.sub()` (line 5248) carries it and `R.head()` does not,
 * so it is opt-in rather than added to every page. A statement needs it: every
 * fixed line on a P&L is prorated across exactly that many days, and a reader
 * counting them off "Aug 15 – 21, 2026" is doing arithmetic the head could
 * have done. It is an OPTION on this one function rather than a second
 * sentence in a page, so no two pages can word the same head differently.
 */
export function rangeSubtitle(
  storeName: string,
  r: DateRange,
  comparisonId: ComparisonId,
  opts: { days?: boolean } = {},
): string {
  const cmp = COMPARISONS.find((c) => c.id === comparisonId)
  const window = rangeLabel(r, "custom")
  const n = dayCount(r)
  const parts = [storeName, window]
  if (opts.days) parts.push(`${n} day${n === 1 ? "" : "s"}`)
  if (cmp) parts.push(cmp.label)
  return parts.join(" · ")
}

/**
 * `Aug 3` — a date with no year, which is how a week row heads itself.
 *
 * Exported beside `shortDate` rather than as a second month table somewhere
 * else: the prototype's `wkLabel()` (line 5074) keeps its own `MO` array and
 * its own formatting, and a copy of that in a component is exactly note 60's
 * defect class in miniature — two functions, one question, two answers.
 */
export function monthDay(d: Date): string {
  return dayLabel(d, false)
}

/**
 * One of note 53's weeks: a Monday-start window, plus what it actually covers.
 *
 * `days` and `partial` are carried rather than re-derived by the reader,
 * because the ONLY honest way to draw a running week is to draw it short and
 * say so — and a caller that has to work out for itself whether a window is
 * short will eventually forget to.
 */
export interface WeekWindow extends DateRange {
  /** Calendar days the window covers. 7, or fewer for the week still running. */
  days: number
  /** True when the window stops short of its own week's Sunday. */
  partial: boolean
}

/** Day keys preserve a week when a UTC server sends it to an LA browser. */
export type SerializedWeekWindow = Omit<WeekWindow, "start" | "end"> & { start: string; end: string }

export function serializeWeekWindow(window: WeekWindow): SerializedWeekWindow {
  return { ...window, start: isoDay(window.start), end: isoDay(window.end) }
}

export function readWeekWindow(window: SerializedWeekWindow): WeekWindow {
  return { ...window, start: parseIsoDay(window.start)!, end: parseIsoDay(window.end)! }
}

/**
 * The last `n` weeks, oldest first, ANCHORED ON TODAY.
 *
 * Note 53: "weekly is the cadence the trade runs on — a prime-cost variance
 * found in week one can be fixed in week two, and the same variance found in a
 * monthly close has already run for four weeks."
 *
 * **Anchored on today, never on the selected range**, and that is the whole
 * design of the thing. These weeks are drawn as a list a reader PRESSES to
 * move the range; if the list were derived from the range, pressing a row
 * would rebuild the list around the row that was pressed and slide the other
 * seven out from under the finger that pressed it. The rows stay put and the
 * marker moves — which is why this function takes no range at all, and cannot
 * be given one.
 *
 * The running week is CLIPPED to today and reports `partial: true` with its
 * real `days`. It is never extended to the Sunday that has not happened, and
 * it is never scaled up to a notional seven days: a part-week's dollars are
 * smaller for that reason alone, and the surface drawing it says so out loud
 * (`WeekTable`'s short-week note) rather than letting the column imply a
 * collapse in trade.
 *
 * `today` is normalised to a local midnight here, for the reason
 * `resolvePreset` normalises: a caller passes `new Date()`, and an unnormalised
 * end would make the running week `6 days 23 hours` and every `dayCount`
 * downstream a rounding question.
 */
export function trailingWeeks(today: Date, n: number): WeekWindow[] {
  const end = startOfDay(today)
  const thisWeek = weekStart(end)
  const out: WeekWindow[] = []

  for (let i = n - 1; i >= 0; i -= 1) {
    const start = addDays(thisWeek, -7 * i)
    const whole = addDays(start, 6)
    const partial = whole.getTime() > end.getTime()
    const last = partial ? end : whole
    // A week that has not started at all yields nothing, rather than a window
    // whose end precedes its start and whose day count is negative.
    if (last.getTime() < start.getTime()) continue
    out.push({ start, end: last, days: dayCount({ start, end: last }), partial })
  }

  return out
}

/**
 * What the window IS, in words, for the line under the dates on the date
 * control: "This week so far", "Week of Oct 26", "October", "Monday".
 *
 * A window reached by the ‹ › arrows or the week row is stored as `from`/`to`
 * (custom), so the preset id alone would call last week "Custom range". A
 * custom window that resolves to exactly what a menu preset gives today is
 * named by that preset; otherwise its shape names it. "so far" marks a window
 * that ends today, because its figures are still moving.
 */
export function describeRange(r: DateRange, presetId: RangeId, today: Date): string {
  const t = startOfDay(today)
  const preset = presetId !== "custom"
    ? PRESETS.find((p) => p.id === presetId)
    : MENU_PRESETS.find((p) => {
      const x = p.resolve(t)
      return isSameDay(x.start, r.start) && isSameDay(x.end, r.end)
    })
  const live = isSameDay(r.end, t)
  if (preset) {
    if (preset.id === "today") return "Today so far"
    if (live && (preset.id === "wtd" || preset.id === "mtd" || preset.id === "ytd")) {
      return `${preset.name} so far`
    }
    return preset.name
  }
  if (dayCount(r) === 1) return WEEKDAYS[r.start.getDay()]
  if (isWeekShaped(r, t)) return `Week of ${dayLabel(r.start, false)}`
  if (isMonthShaped(r, t)) {
    const name = MONTH_LONG[r.start.getMonth()]
    return r.start.getFullYear() === t.getFullYear() ? name : `${name} ${r.start.getFullYear()}`
  }
  return "Custom range"
}

const MONTH_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

/**
 * The comparison in a sentence a reader can check against the calendar:
 * "Comparing Nov 2 – 3 with Oct 26 – 27". The weekday comparison reads four
 * windows, so it names the rule instead of four sets of dates.
 */
export function compareSentence(r: DateRange, mode: ComparisonId): string {
  const now = rangeLabel(r, "custom")
  if (mode === "none") return `Showing ${now} with no comparison.`
  if (mode === "weekday") {
    return comparisonWindows(r, mode) === null
      ? `Showing ${now}.`
      : `Comparing ${now} with the same days in each of the 4 weeks before.`
  }
  const c = comparisonRange(r, mode)
  return c === null ? `Showing ${now}.` : `Comparing ${now} with ${rangeLabel(c, "custom")}.`
}

/** True when `r` is exactly the Monday week starting `weekStartDay` (or its running part). */
export function isWeekWindow(r: DateRange, weekStartDay: Date): boolean {
  return isSameDay(r.start, weekStartDay) && dayCount(r) <= 7 && weekStart(r.end).getTime() === weekStartDay.getTime()
}

/** The Monday week holding `day`, ended at `today` while it is still running. */
export function weekOf(day: Date, today: Date): DateRange {
  const start = weekStart(day)
  const whole = addDays(start, 6)
  const t = startOfDay(today)
  // A week that has not started yet: today, rather than an inverted window.
  if (start.getTime() > t.getTime()) return { start: t, end: t }
  return { start, end: whole.getTime() > t.getTime() ? t : whole }
}
