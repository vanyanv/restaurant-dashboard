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
