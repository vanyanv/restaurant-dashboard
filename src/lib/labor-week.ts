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

/** Variance above this fraction of forecast renders as overbudget. */
export const LABOR_OVERBUDGET_THRESHOLD = 0.05

export type LaborWeekWindow = {
  weekStart: Date
  /** Day 7 at UTC midnight — HarriDailyLabor.date is @db.Date (rows at UTC
   * midnight), so an lte on this instant includes the final day. */
  weekEnd: Date
  priorWeekStart: Date
  priorWeekEnd: Date
  weekIso: string
  thisWeekIso: string
  isCurrentWeek: boolean
}

export function buildLaborWeekWindow(
  weekParam: string | undefined,
  now: Date = new Date()
): LaborWeekWindow {
  const weekStart = parseWeekParam(weekParam)
  const weekEnd = addDaysUTC(weekStart, 6)
  const priorWeekStart = addDaysUTC(weekStart, -7)
  const priorWeekEnd = addDaysUTC(weekStart, -1)
  const weekIso = isoDate(weekStart)
  const thisWeekIso = isoDate(isoMondayUTC(now))
  return {
    weekStart,
    weekEnd,
    priorWeekStart,
    priorWeekEnd,
    weekIso,
    thisWeekIso,
    isCurrentWeek: weekIso === thisWeekIso,
  }
}

type LaborCostRow = { actualCost: number | null; forecastCost: number | null }

export type LaborWeekAggregate = {
  totalActual: number
  totalForecast: number
  variance: number
  /** null when the week has no forecast at all. */
  variancePct: number | null
  overbudget: boolean
  daysWithData: number
  priorActual: number
  /** Requires at least one non-null prior actual AND a positive total. */
  hasPrior: boolean
  wowDelta: number | null
  wowOverbudget: boolean
}

export function aggregateLaborWeek(
  rows: LaborCostRow[],
  priorRows: LaborCostRow[]
): LaborWeekAggregate {
  const totalActual = rows.reduce((s, r) => s + (r.actualCost ?? 0), 0)
  const totalForecast = rows.reduce((s, r) => s + (r.forecastCost ?? 0), 0)
  const variance = totalActual - totalForecast
  const variancePct = totalForecast === 0 ? null : variance / totalForecast
  const overbudget =
    variancePct != null && variancePct > LABOR_OVERBUDGET_THRESHOLD

  const priorActual = priorRows.reduce((s, r) => s + (r.actualCost ?? 0), 0)
  const hasPrior =
    priorRows.some((r) => r.actualCost != null) && priorActual > 0
  const wowDelta = hasPrior ? (totalActual - priorActual) / priorActual : null
  const wowOverbudget =
    wowDelta != null && wowDelta > LABOR_OVERBUDGET_THRESHOLD

  return {
    totalActual,
    totalForecast,
    variance,
    variancePct,
    overbudget,
    daysWithData: rows.filter((r) => r.actualCost != null).length,
    priorActual,
    hasPrior,
    wowDelta,
    wowOverbudget,
  }
}

export function groupAlertsByDate<T extends { date: string }>(
  alerts: T[]
): Record<string, T[]> {
  const grouped: Record<string, T[]> = {}
  for (const a of alerts) {
    if (!grouped[a.date]) grouped[a.date] = []
    grouped[a.date].push(a)
  }
  return grouped
}
