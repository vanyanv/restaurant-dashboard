/**
 * Day-level labor scorecard — the table that answers "which day leaked, and
 * how much".
 *
 * Three hour figures sit side by side and each means something different:
 *   scheduled — what the manager published (HarriShift)
 *   actual    — what was worked (HarriPositionDaily.actualSeconds)
 *   earned    — what the day's sales justified (netSales / target SPLH)
 *
 * scheduled − actual is execution drift (people staying late, clocking in
 * early). actual − earned is whether the plan itself was right. Conflating
 * them hides which of the two is costing money.
 */

import { median } from "@/lib/splh"

export interface ScorecardInput {
  date: string
  netSales: number
  actualHours: number
  scheduledHours: number
  laborCost: number
  alertCount: number
}

export interface ScorecardRow extends ScorecardInput {
  weekday: string
  splh: number | null
  /** Hours the day's sales justified at the weekday target. */
  earnedHours: number | null
  /** actual − earned. Positive = overstaffed for the business done. */
  varianceHours: number | null
  varianceDollars: number | null
  /** scheduled − actual. Positive = worked fewer hours than published. */
  scheduleDriftHours: number
  laborPct: number | null
  status: "on" | "over" | "under" | "unknown"
}

export interface ScorecardTotals {
  netSales: number
  actualHours: number
  scheduledHours: number
  earnedHours: number
  varianceHours: number
  varianceDollars: number
  laborCost: number
  splh: number | null
  laborPct: number | null
  alertCount: number
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const TOLERANCE = 0.1

function weekdayIndex(date: string): number {
  return new Date(date + "T00:00:00.000Z").getUTCDay()
}

/** Median SPLH per weekday from a trailing history. */
export function scorecardTargets(
  history: Array<{ date: string; netSales: number; actualHours: number }>
): Array<number | null> {
  const buckets: number[][] = Array.from({ length: 7 }, () => [])
  for (const h of history) {
    if (h.actualHours <= 0) continue
    buckets[weekdayIndex(h.date)].push(h.netSales / h.actualHours)
  }
  return buckets.map((b) => median(b))
}

export function buildScorecard(
  rows: ScorecardInput[],
  targets: Array<number | null>,
  blendedRate: number | null
): ScorecardRow[] {
  return rows.map((r) => {
    const splh = r.actualHours > 0 ? r.netSales / r.actualHours : null
    const target = targets[weekdayIndex(r.date)]
    const earnedHours = target != null && target > 0 ? r.netSales / target : null
    const varianceHours = earnedHours != null ? r.actualHours - earnedHours : null

    let status: ScorecardRow["status"] = "unknown"
    if (splh != null && target != null && target > 0) {
      status =
        splh < target * (1 - TOLERANCE)
          ? "over"
          : splh > target * (1 + TOLERANCE)
            ? "under"
            : "on"
    }

    return {
      ...r,
      weekday: WEEKDAYS[weekdayIndex(r.date)],
      splh,
      earnedHours,
      varianceHours,
      varianceDollars:
        varianceHours != null && blendedRate != null ? varianceHours * blendedRate : null,
      scheduleDriftHours: r.scheduledHours - r.actualHours,
      laborPct: r.netSales > 0 ? r.laborCost / r.netSales : null,
      status,
    }
  })
}

export function scorecardTotals(rows: ScorecardRow[]): ScorecardTotals {
  const t: ScorecardTotals = {
    netSales: 0, actualHours: 0, scheduledHours: 0, earnedHours: 0,
    varianceHours: 0, varianceDollars: 0, laborCost: 0,
    splh: null, laborPct: null, alertCount: 0,
  }
  for (const r of rows) {
    t.netSales += r.netSales
    t.actualHours += r.actualHours
    t.scheduledHours += r.scheduledHours
    t.laborCost += r.laborCost
    t.alertCount += r.alertCount
    // Only days with a target contribute to the earned/variance totals, so the
    // footer can never imply coverage the data doesn't have.
    if (r.earnedHours != null) t.earnedHours += r.earnedHours
    if (r.varianceHours != null) t.varianceHours += r.varianceHours
    if (r.varianceDollars != null) t.varianceDollars += r.varianceDollars
  }
  t.splh = t.actualHours > 0 ? t.netSales / t.actualHours : null
  t.laborPct = t.netSales > 0 ? t.laborCost / t.netSales : null
  return t
}
