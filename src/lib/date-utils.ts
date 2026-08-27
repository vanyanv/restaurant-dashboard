/**
 * Shared day-boundary helpers. Names are timezone-explicit on purpose:
 * forecast/summary tables store dates as Postgres @db.Date (UTC midnight),
 * so server-side bucketing must use the UTC variants or rows silently drop
 * when the process runs in a non-UTC zone (local dev in PDT vs Vercel's UTC).
 *
 * startOfDayLocal exists for the few call sites that intentionally bucket in
 * the process's local zone (e.g. client-facing presets). If you're matching
 * DB rows, you almost certainly want the UTC variant.
 */

/** UTC calendar date as "YYYY-MM-DD". */
export function ymdUTC(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Non-mutating floor to UTC midnight. */
export function startOfDayUTC(d: Date): Date {
  const out = new Date(d)
  out.setUTCHours(0, 0, 0, 0)
  return out
}

/** Non-mutating floor to local (process TZ) midnight. */
export function startOfDayLocal(d: Date): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  return out
}

// ─── UTC calendar arithmetic ───
//
// UTC has no DST, so every day is exactly 86,400,000ms — ms arithmetic on a
// UTC instant is exact where the local-time date-fns equivalent (addDays,
// startOfWeek, endOfWeek, startOfMonth, endOfMonth, differenceInCalendarDays,
// format) would drift by the process's UTC offset. These exist for callers
// (buildPeriods in src/lib/pnl.ts) that walk UTC-midnight instants and must
// keep landing on UTC-midnight instants regardless of the server's TZ.

/** Non-mutating add of `n` days to a UTC instant. */
export function addDaysUTC(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000)
}

/** Start (UTC midnight) of the UTC calendar week containing `d`. */
export function startOfWeekUTC(d: Date, weekStartsOn: number): Date {
  const start = startOfDayUTC(d)
  const diff = (start.getUTCDay() - weekStartsOn + 7) % 7
  return addDaysUTC(start, -diff)
}

/** End (23:59:59.999 UTC) of the UTC calendar week containing `d`. */
export function endOfWeekUTC(d: Date, weekStartsOn: number): Date {
  const end = addDaysUTC(startOfWeekUTC(d, weekStartsOn), 6)
  end.setUTCHours(23, 59, 59, 999)
  return end
}

/** Start (UTC midnight, day 1) of the UTC calendar month containing `d`. */
export function startOfMonthUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
}

/** End (23:59:59.999 UTC, last day) of the UTC calendar month containing `d`. */
export function endOfMonthUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59, 999))
}

/** Difference in UTC calendar days between two instants (ignores time of day). */
export function differenceInCalendarDaysUTC(later: Date, earlier: Date): number {
  const a = Date.UTC(later.getUTCFullYear(), later.getUTCMonth(), later.getUTCDate())
  const b = Date.UTC(earlier.getUTCFullYear(), earlier.getUTCMonth(), earlier.getUTCDate())
  return Math.round((a - b) / 86_400_000)
}

/**
 * Format a UTC instant with one of the three date-fns patterns `buildPeriods`
 * uses. Built on Intl rather than string surgery so the weekday/month names
 * keep matching what date-fns produced under UTC (chart axis labels).
 */
export function formatUTC(d: Date, pattern: "EEE MMM d" | "MMM d" | "MMM yyyy"): string {
  const partsFor = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...opts }).formatToParts(d)
  const get = (parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)!.value

  if (pattern === "EEE MMM d") {
    const parts = partsFor({ weekday: "short", month: "short", day: "numeric" })
    return `${get(parts, "weekday")} ${get(parts, "month")} ${get(parts, "day")}`
  }
  if (pattern === "MMM d") {
    const parts = partsFor({ month: "short", day: "numeric" })
    return `${get(parts, "month")} ${get(parts, "day")}`
  }
  const parts = partsFor({ month: "short", year: "numeric" })
  return `${get(parts, "month")} ${get(parts, "year")}`
}
