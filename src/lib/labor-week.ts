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

export function parseWeekParam(s: string | undefined): Date {
  if (s) {
    const d = new Date(`${s}T00:00:00.000Z`)
    if (!Number.isNaN(d.getTime())) return isoMondayUTC(d)
  }
  return isoMondayUTC(new Date())
}

export function addDaysUTC(d: Date, n: number): Date {
  const out = new Date(d)
  out.setUTCDate(out.getUTCDate() + n)
  return out
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}
