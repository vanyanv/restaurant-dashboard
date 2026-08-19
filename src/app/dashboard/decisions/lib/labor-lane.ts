import { SPLH_TOLERANCE } from "@/lib/splh"

/**
 * Scheduled hours against the hours a day's forecast would earn.
 *
 * The ribbon used to render staffing as `+1` / `-1` / "no schedule" — a
 * direction with no magnitude, and mostly "no schedule", because the staffing
 * classifier read `HarriDailyLabor.forecastCost` and that table carries no rows
 * past today. `HarriShift` has the published schedule, in hours, roughly two
 * weeks out.
 *
 * "Needed" is the store's own median sales-per-labor-hour for that weekday
 * (`weekdayTargets` in `lib/splh`), not a target nobody configured. So the lane
 * says "staffed for a typical Saturday" or "not", which the data supports.
 * It is a productivity benchmark, not an optimum — if the store is habitually
 * short on Saturdays, a typical Saturday is what it measures against.
 */
export type LaborLaneStatus =
  /** Fewer hours than the forecast earns. */
  | "short"
  /** More hours than the forecast earns. */
  | "heavy"
  /** Within tolerance either way. */
  | "level"
  /** No shifts published for the day at all. */
  | "unscheduled"
  /** No forecast, or no history for this weekday to judge against. */
  | "unknown"

export interface LaborLane {
  scheduledHours: number
  /** Hours the forecast earns at this weekday's typical productivity. */
  neededHours: number | null
  /** scheduled − needed. Negative means short. */
  gapHours: number | null
  status: LaborLaneStatus
  /** Shifts published with nobody assigned (`HarriShift.isVirtual`). */
  unfilledSlots: number
}

const round1 = (n: number) => Math.round(n * 10) / 10

export function computeLaborLane(input: {
  forecastRevenue: number
  scheduledHours: number
  /** Median $/labor-hour for this weekday; null when history is too thin. */
  targetSplh: number | null
  unfilledSlots: number
}): LaborLane {
  const { forecastRevenue, scheduledHours, targetSplh, unfilledSlots } = input

  const blank = {
    scheduledHours: round1(scheduledHours),
    neededHours: null,
    gapHours: null,
    unfilledSlots,
  }

  if (targetSplh == null || targetSplh <= 0 || forecastRevenue <= 0) {
    return { ...blank, status: "unknown" }
  }

  const neededHours = round1(forecastRevenue / targetSplh)

  // Distinct from "short": nobody has published anything, which is a different
  // conversation with the manager than a schedule that is merely thin.
  if (scheduledHours <= 0) {
    return { ...blank, neededHours, status: "unscheduled" }
  }

  const gapHours = round1(scheduledHours - neededHours)
  // Same tolerance the SPLH chart uses, so the two surfaces agree about which
  // days are worth flagging.
  const slack = neededHours * SPLH_TOLERANCE

  return {
    scheduledHours: round1(scheduledHours),
    neededHours,
    gapHours,
    unfilledSlots,
    status: gapHours < -slack ? "short" : gapHours > slack ? "heavy" : "level",
  }
}
