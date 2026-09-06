/**
 * Shared Monday-aligned UTC week math for labor pages (mobile + desktop).
 * Lifted from the desktop and mobile copies so the two pages can't drift apart.
 */

export function isoMondayUTC(d: Date): Date {
  const out = new Date(d)
  out.setUTCHours(0, 0, 0, 0)
  const dow = out.getUTCDay()
  const offset = dow === 0 ? -6 : 1 - dow
  out.setUTCDate(out.getUTCDate() + offset)
  return out
}

/**
 * De-duplicated, ascending list of Monday week-starts covering every day in
 * `days` — one entry per ISO week touched.
 *
 * Harri's positions/pay_types endpoint is not per-day addressable: a Monday
 * `from_date` returns the whole week, a non-Monday `from_date` 500s, and a
 * range spilling past that week's Sunday 400s (verified 2026-08-18). This
 * turns an arbitrary day range into the one call shape it accepts.
 */
export function isoWeekStartsCovering(days: Date[]): Date[] {
  const seen = new Map<number, Date>()
  for (const d of days) {
    const wk = isoMondayUTC(d)
    seen.set(wk.getTime(), wk)
  }
  return [...seen.values()].sort((a, b) => a.getTime() - b.getTime())
}

export function addDaysUTC(d: Date, n: number): Date {
  const out = new Date(d)
  out.setUTCDate(out.getUTCDate() + n)
  return out
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}
