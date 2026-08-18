/**
 * Sales per labor hour (SPLH) — the productivity half of the labor picture.
 *
 * Labor cost answers "what did we spend"; SPLH answers "was that the right
 * amount of labor for the business we did". Raw SPLH can't be compared across
 * days — Saturday outsells Tuesday no matter how well either is staffed — so
 * every day is scored against a target for ITS weekday, using the standard
 * operator formulation:
 *
 *   SPLH          = net sales / labor hours
 *   earned hours  = net sales / target SPLH     ← hours the day deserved
 *   variance      = actual hours - earned hours ← positive means overstaffed
 *   variance $    = variance hours * blended hourly rate
 *
 * Pure functions only — no Prisma, no session. The server action in
 * app/actions/splh-actions.ts supplies the rows.
 */

import { isoMondayUTC, isoDate } from "@/lib/labor-week"

export interface SplhInput {
  /** LA calendar date, "YYYY-MM-DD". */
  date: string
  netSales: number
  laborHours: number
  laborCost: number
}

export type SplhStatus = "on" | "over" | "under" | "unknown"

export interface SplhPoint {
  date: string
  /** Short axis label — "Mon 17" for days, "Aug 17" for weeks. */
  label: string
  weekday: number
  netSales: number
  laborHours: number
  splh: number | null
  targetSplh: number | null
  earnedHours: number | null
  /** Actual minus earned. Positive = overstaffed. */
  varianceHours: number | null
  varianceDollars: number | null
  status: SplhStatus
}

/**
 * How far SPLH may sit from target before the day is flagged. Tighter than
 * this and normal weather/event noise lights the chart up red every week.
 */
export const SPLH_TOLERANCE = 0.1

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const MONTH_LABELS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]

/** Parse a "YYYY-MM-DD" date string as UTC midnight. */
function parseDay(date: string): Date {
  return new Date(date + "T00:00:00.000Z")
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/**
 * Day-weighted blended rate (total cost / total hours), NOT the mean of
 * per-day rates — a short day would otherwise count as much as a long one.
 */
export function blendedHourlyRate(rows: SplhInput[]): number | null {
  let cost = 0
  let hours = 0
  for (const r of rows) {
    cost += r.laborCost
    hours += r.laborHours
  }
  return hours > 0 ? cost / hours : null
}

/**
 * Median SPLH per weekday index (0 = Sunday), from whatever history is given.
 * Days with no hours are skipped rather than dividing by zero.
 */
export function weekdayTargets(history: SplhInput[]): Array<number | null> {
  const buckets: number[][] = Array.from({ length: 7 }, () => [])
  for (const r of history) {
    if (r.laborHours <= 0) continue
    buckets[parseDay(r.date).getUTCDay()].push(r.netSales / r.laborHours)
  }
  return buckets.map((b) => median(b))
}

function classify(splh: number | null, target: number | null): SplhStatus {
  if (splh == null || target == null || target <= 0) return "unknown"
  if (splh < target * (1 - SPLH_TOLERANCE)) return "over"
  if (splh > target * (1 + SPLH_TOLERANCE)) return "under"
  return "on"
}

/**
 * Score each row against the weekday targets derived from `history`.
 * `history` should be a longer trailing window than `rows` so the target is
 * not defined by the same handful of days being scored.
 */
export function buildSplhSeries(
  rows: SplhInput[],
  history: SplhInput[],
  opts?: { weekly?: boolean }
): SplhPoint[] {
  const targets = weekdayTargets(history)
  const rate = blendedHourlyRate(history) ?? blendedHourlyRate(rows)

  return rows.map((r) => {
    const d = parseDay(r.date)
    const weekday = d.getUTCDay()
    const splh = r.laborHours > 0 ? r.netSales / r.laborHours : null

    // A weekly bar spans all seven weekdays, so a single weekday's median is
    // the wrong yardstick — blend the seven into one week-level target.
    const target = opts?.weekly
      ? median(targets.filter((t): t is number => t != null))
      : targets[weekday]

    const earnedHours = target != null && target > 0 ? r.netSales / target : null
    const varianceHours = earnedHours != null ? r.laborHours - earnedHours : null
    const varianceDollars =
      varianceHours != null && rate != null ? varianceHours * rate : null

    return {
      date: r.date,
      label: opts?.weekly
        ? `${MONTH_LABELS[d.getUTCMonth()]} ${d.getUTCDate()}`
        : `${WEEKDAY_LABELS[weekday]} ${d.getUTCDate()}`,
      weekday,
      netSales: r.netSales,
      laborHours: r.laborHours,
      splh,
      targetSplh: target,
      earnedHours,
      varianceHours,
      varianceDollars,
      status: classify(splh, target),
    }
  })
}

/**
 * Score an ascending sequence against a TRAILING median of the preceding
 * `window` entries, returning only the last `showCount` points.
 *
 * Weeks need this rather than a fixed historical median: a store that has
 * genuinely improved would otherwise be measured against a stale block and
 * every recent week would read "understaffed" forever. Each week is compared
 * to the weeks just before it, so the line tracks the operation.
 */
export function buildSplhSeriesRolling(
  sequence: SplhInput[],
  showCount: number,
  window: number,
  opts?: { weekly?: boolean }
): SplhPoint[] {
  const splhAt = (r: SplhInput): number | null =>
    r.laborHours > 0 ? r.netSales / r.laborHours : null

  const startIdx = Math.max(0, sequence.length - showCount)
  const rate = blendedHourlyRate(sequence)
  const out: SplhPoint[] = []

  for (let i = startIdx; i < sequence.length; i++) {
    const r = sequence[i]
    const d = parseDay(r.date)
    const weekday = d.getUTCDay()
    const splh = splhAt(r)

    const priorValues: number[] = []
    for (let j = Math.max(0, i - window); j < i; j++) {
      const v = splhAt(sequence[j])
      if (v != null) priorValues.push(v)
    }
    const target = median(priorValues)

    const earnedHours = target != null && target > 0 ? r.netSales / target : null
    const varianceHours = earnedHours != null ? r.laborHours - earnedHours : null

    out.push({
      date: r.date,
      label: opts?.weekly
        ? `${MONTH_LABELS[d.getUTCMonth()]} ${d.getUTCDate()}`
        : `${WEEKDAY_LABELS[weekday]} ${d.getUTCDate()}`,
      weekday,
      netSales: r.netSales,
      laborHours: r.laborHours,
      splh,
      targetSplh: target,
      earnedHours,
      varianceHours,
      varianceDollars:
        varianceHours != null && rate != null ? varianceHours * rate : null,
      status: classify(splh, target),
    })
  }
  return out
}

/**
 * Sum daily rows into Monday-anchored ISO weeks, ascending.
 *
 * `dropPartial` removes any week with fewer than 7 days of data — without it
 * the in-progress week renders as a full-height bar built from one or two
 * days, which reads as a collapse in staffing rather than a Tuesday.
 */
export function rollToWeeks(
  rows: SplhInput[],
  opts?: { dropPartial?: boolean }
): SplhInput[] {
  const byWeek = new Map<string, SplhInput & { dayCount: number }>()
  for (const r of rows) {
    const key = isoDate(isoMondayUTC(parseDay(r.date)))
    const acc = byWeek.get(key)
    if (acc) {
      acc.netSales += r.netSales
      acc.laborHours += r.laborHours
      acc.laborCost += r.laborCost
      acc.dayCount += 1
    } else {
      byWeek.set(key, { ...r, date: key, dayCount: 1 })
    }
  }
  return [...byWeek.values()]
    .filter((w) => !opts?.dropPartial || w.dayCount >= 7)
    .map(({ dayCount: _dayCount, ...w }) => w)
    .sort((a, b) => a.date.localeCompare(b.date))
}
