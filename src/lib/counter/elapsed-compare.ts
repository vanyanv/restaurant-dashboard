import { addDays } from "date-fns"
import { BUSINESS_TIME_ZONE, businessCalendarDate, businessDay } from "@/lib/counter/business-date"
import { comparisonWindows, dayCount, isoDay, rangeLabel, type DateRange } from "@/lib/counter/date-range"

/**
 * The one function that decides whether the LAST DAY of a range is finished,
 * and, when it is not, the comparison that compares like with like.
 *
 * Why it exists: an auditor opened the Overview early one morning and read
 * "Every store sold less: Glendale -56%, Hollywood -50%". The real full days
 * were flat. The range ended on a day that was still trading (today) or still
 * syncing (yesterday, before Otter's sync had caught up with a close at 1-2am
 * LA), and `comparisonRange` put that part-day against the same weekday last
 * week IN FULL. Half a day against a whole one always reads as a collapse.
 *
 * The rule here:
 *
 * - A day is INCOMPLETE when it is today in Los Angeles, or when the newest
 *   evidence of a sync (the latest successful `otter.metrics.sync` run, or,
 *   with none on file, the newest `OtterHourlySummary` row) does not reach
 *   `DAY_COMPLETE_THROUGH_HOUR` on the morning after. Stores close 1-2am, so
 *   data through 03:00 LA the next morning holds the whole day.
 * - An incomplete day is compared hour for hour: current sales through the
 *   last synced hour against the prior period's same days cut at the same
 *   hour, both read from `OtterHourlySummary`. Without hourly data on either
 *   side there is no fair figure, so there is no percent at all.
 * - A COMPLETED period still compares in full. Nothing here touches that.
 *
 * This module is pure; the reads live in `adapters/elapsed-compare.ts`, so a
 * test can exercise every branch without a database.
 */

/** Data through this LA hour on the morning after counts as the whole day (stores close 1-2am). */
export const DAY_COMPLETE_THROUGH_HOUR = 3

/** How many days back a range's last day can still be unsynced; older days are taken as complete without a read. */
export const INCOMPLETE_LOOKBACK_DAYS = 3

/** An LA wall-clock reading: business day key and hour 0-23. */
export interface LaClock {
  day: string
  hour: number
}

const hourFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TIME_ZONE,
  hourCycle: "h23",
  hour: "2-digit",
})

/** An instant's LA business day and hour. */
export function laClock(instant: Date): LaClock {
  const h = Number(hourFmt.formatToParts(instant).find((p) => p.type === "hour")!.value)
  return { day: businessDay(instant), hour: h === 24 ? 0 : h }
}

const atOrAfter = (a: LaClock, b: LaClock) => a.day > b.day || (a.day === b.day && a.hour >= b.hour)

export type DayState = "complete" | "today" | "syncing"

/** The range's last day that can have trading: its end, or today when the range runs past today. */
export function lastTradingDay(range: DateRange, now: Date): Date {
  const today = businessCalendarDate(now)
  return range.end.getTime() > today.getTime() ? today : range.end
}

/** Cheap, read-free: could the range's last day still be incomplete? False means compare in full without asking. */
export function mayBeIncomplete(range: DateRange, now: Date): boolean {
  const today = businessCalendarDate(now)
  const last = lastTradingDay(range, now)
  if (range.start.getTime() > last.getTime()) return false
  return isoDay(last) >= isoDay(addDays(today, -INCOMPLETE_LOOKBACK_DAYS))
}

export interface DayStateInput {
  range: DateRange
  now: Date
  /** Start of the latest SUCCESSFUL Otter sync run for the stores in scope, or null with none on file. */
  lastSyncAt: Date | null
  /** The newest `OtterHourlySummary` row for the stores in scope, or null with none. */
  newestHourly: LaClock | null
}

/**
 * Whether the range's last day is complete.
 *
 * With no sync run and no hourly row on file there is nothing to say a day is
 * unfinished, so a past day reads as complete (the full comparison, as
 * before). Today is never complete.
 */
export function lastDayState(input: DayStateInput): DayState {
  const today = businessCalendarDate(input.now)
  const last = lastTradingDay(input.range, input.now)
  if (isoDay(last) >= isoDay(today)) return "today"
  const closed: LaClock = { day: isoDay(addDays(last, 1)), hour: DAY_COMPLETE_THROUGH_HOUR }
  const signal = input.lastSyncAt ? laClock(input.lastSyncAt) : input.newestHourly
  if (signal === null) return "complete"
  return atOrAfter(signal, closed) ? "complete" : "syncing"
}

/** One `OtterHourlySummary` row, as much as the comparison reads. */
export interface HourlyRow {
  storeId: string
  /** LA calendar date, `YYYY-MM-DD`. */
  day: string
  /** LA local hour, 0-23. */
  hour: number
  netSales: number
}

export interface ElapsedCompare {
  state: Exclude<DayState, "complete">
  /** Exclusive LA hour both sides are cut at on their last day (24 = the whole day); null when hourly data is missing. */
  throughHour: number | null
  /** Reads after "on" / "vs": "the same time last Wednesday". */
  label: string
  /** Reads where a comparison is described on its own: "so far today (through 11 am), vs the same time last Wednesday". */
  against: string
  /** A sentence of its own for the page's summary. */
  note: string
  /** Net sales through the cut, current and prior; null when either side has no hourly data. */
  current: number | null
  prior: number | null
  /** The same per store, keyed by store id. Empty when the totals are null. */
  perStore: Record<string, { current: number; prior: number }>
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

/** An exclusive end hour in words: 11 → "11 am", 23 → "11 pm", 24 → "midnight". */
export function hourWords(h: number): string {
  const x = ((h % 24) + 24) % 24
  if (x === 0) return "midnight"
  if (x === 12) return "noon"
  return x < 12 ? `${x} am` : `${x - 12} pm`
}

export interface ElapsedInput {
  range: DateRange
  state: Exclude<DayState, "complete">
  now: Date
  /** Hourly rows covering the current range and its prior window (`priorElapsedWindow`). */
  rows: HourlyRow[]
  /** The newest hourly row on file for the stores in scope, to tell a fully synced day from a part-synced one. */
  newestHourly: LaClock | null
}

/** The current window the comparison reads: the range clipped to its last trading day. */
export function currentElapsedWindow(range: DateRange, now: Date): DateRange {
  return { start: range.start, end: lastTradingDay(range, now) }
}

/** Its prior period of the same length, weekday for weekday (`comparisonWindows(…, "prev")`). */
export function priorElapsedWindow(range: DateRange, now: Date): DateRange | null {
  return comparisonWindows(currentElapsedWindow(range, now), "prev")?.[0] ?? null
}

/**
 * The like-with-like comparison for a range whose last day is incomplete.
 *
 * Both windows are summed in full except their last day, which is cut at the
 * same hour: the last hour synced for the current day. For today the hour in
 * progress is left out, since its sales are still arriving.
 */
export function buildElapsedCompare(input: ElapsedInput): ElapsedCompare {
  const { range, state, now, rows, newestHourly } = input
  const cur = currentElapsedWindow(range, now)
  const prior = priorElapsedWindow(range, now)
  const today = businessCalendarDate(now)
  const lastKey = isoDay(cur.end)
  const single = dayCount(cur) === 1
  const isYesterday = lastKey === isoDay(addDays(today, -1))
  const dayName = state === "today" ? "Today" : isYesterday ? "Yesterday" : rangeLabel({ start: cur.end, end: cur.end }, "custom")

  // The cut: the whole day once a later day has rows, else the newest hour on it.
  let through: number | null = null
  if (newestHourly && newestHourly.day > lastKey) through = 24
  else {
    const onLast = rows.filter((r) => r.day === lastKey)
    if (onLast.length > 0) through = Math.max(...onLast.map((r) => r.hour)) + 1
  }
  if (through !== null && state === "today") {
    const clock = laClock(now)
    if (clock.day === lastKey) through = Math.min(through, clock.hour)
  }
  if (through !== null && through <= 0) through = null

  const priorWords = prior
    ? single && isoDay(addDays(cur.end, -7)) === isoDay(prior.end)
      ? `last ${WEEKDAYS[prior.end.getDay()]}`
      : `of ${rangeLabel(prior, "custom")}`
    : ""
  const label = state === "today" ? `the same time ${priorWords}` : `the same hours ${priorWords}`

  const waits = (): ElapsedCompare => ({
    state,
    throughHour: null,
    label,
    against:
      state === "today"
        ? "today is still trading: the comparison waits until the day is complete"
        : `${dayName === "Yesterday" ? "yesterday" : dayName} is still syncing: the comparison waits until the day is complete`,
    note:
      state === "today"
        ? "Today is still trading, so the comparison with the period before waits until the day is complete."
        : `${dayName} is still syncing, so the comparison with the period before waits until the day is complete.`,
    current: null,
    prior: null,
    perStore: {},
  })

  if (prior === null || through === null) return waits()

  const sum = (w: DateRange, cutHour: number) => {
    const from = isoDay(w.start)
    const last = isoDay(w.end)
    const total = { all: 0, rows: 0, byStore: new Map<string, number>() }
    for (const r of rows) {
      if (r.day < from || r.day > last) continue
      if (r.day === last && r.hour >= cutHour) continue
      total.all += r.netSales
      total.rows += 1
      total.byStore.set(r.storeId, (total.byStore.get(r.storeId) ?? 0) + r.netSales)
    }
    return total
  }
  const now_ = sum(cur, through)
  const then = sum(prior, through)
  if (now_.rows === 0 || then.rows === 0) return waits()

  const perStore: ElapsedCompare["perStore"] = {}
  for (const id of new Set([...now_.byStore.keys(), ...then.byStore.keys()])) {
    perStore[id] = { current: now_.byStore.get(id) ?? 0, prior: then.byStore.get(id) ?? 0 }
  }

  const at = hourWords(through)
  return {
    state,
    throughHour: through,
    label,
    against:
      state === "today"
        ? `so far today (through ${at}), vs ${label}`
        : `${dayName} is still syncing (through ${at}): vs ${label}`,
    note:
      state === "today"
        ? `So far today, through ${at}, compared with ${label}.`
        : `${dayName} is still syncing (through ${at}), so sales are compared with ${label}.`,
    current: now_.all,
    prior: then.all,
    perStore,
  }
}

/**
 * When the reads fail: today is still incomplete (so no percent); a past day
 * cannot be judged, so it compares in full as it did before this existed.
 */
export function elapsedWithoutReads(range: DateRange, now: Date): ElapsedCompare | null {
  const state = lastDayState({ range, now, lastSyncAt: null, newestHourly: null })
  if (state === "complete") return null
  return buildElapsedCompare({ range, state, now, rows: [], newestHourly: null })
}
