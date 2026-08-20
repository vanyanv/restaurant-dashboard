/**
 * The week read as one thing.
 *
 * The page opened with seven day cells and a bulleted briefing, so answering
 * "how big is this week, and am I staffed for it" meant adding seven numbers by
 * hand. These four cells are the masthead reading the design principle asked
 * for — hierarchy is verdict → week → actions, and this is the row of numbers
 * the verdict sits on.
 *
 * Everything here is derived from what `getDecisionsView` already loads. No new
 * query, no second opinion: where the day cells and the labor lane have already
 * decided something, this sums their decision rather than recomputing it from
 * source and risking a different answer on the same screen.
 */

import { SPLH_TOLERANCE } from "@/lib/splh"
import type { LaborLaneStatus } from "@/app/dashboard/decisions/lib/labor-lane"
import type { Scorecard } from "@/app/dashboard/decisions/lib/scorecard"

/** The slice of a `DecisionDay` this reading needs. */
export interface VitalsDay {
  predictedRevenue: number
  p10: number | null
  p90: number | null
  /** This day's forecast against the same weekday a week ago. */
  pctVsTrailing: number | null
  labor: {
    scheduledHours: number
    neededHours: number | null
    gapHours: number | null
    status: LaborLaneStatus
    unfilledSlots: number
  }
}

export type GapStatus = "short" | "heavy" | "level" | "unknown"
export type RateStatus = "above" | "below" | "level" | "unknown"

export interface Vitals {
  weekForecast: {
    /** Null when there are no days to sum — distinct from a forecast of zero. */
    total: number | null
    /** The 80% band, summed only when every day carried one. */
    p10: number | null
    p90: number | null
    daysCounted: number
    /**
     * The week against the week before it, as a fraction. Null unless every
     * day carried a comparison — a partial sum would understate the change.
     */
    vsPriorWeek: number | null
  }
  laborGap: {
    /** Scheduled − needed across the week. Negative is short. */
    hours: number | null
    status: GapStatus
    /** Days short and days heavy cancel in `hours`; these keep that detail. */
    shortDays: number
    heavyDays: number
    /** Days with nothing published at all — a different problem than thin. */
    unscheduledDays: number
    /** Shifts published with nobody on them, across the week. */
    unfilledSlots: number
  }
  splh: {
    /** Week forecast per scheduled hour. */
    actual: number | null
    /** The rate the lane judged against, recovered from its own arithmetic. */
    target: number | null
    status: RateStatus
  }
  accuracy: {
    wape: number | null
    beatsBaselineBy: number | null
    sampleSize: number
  } | null
}

const round1 = (n: number) => Math.round(n * 10) / 10

export function computeVitals(input: {
  days: VitalsDay[]
  scorecard: Scorecard | null
}): Vitals {
  const { days, scorecard } = input

  // ---- week forecast -------------------------------------------------------
  const total = days.length > 0 ? days.reduce((s, d) => s + d.predictedRevenue, 0) : null

  // A band summed over five of seven days is narrower than the truth, and reads
  // as more confidence than the model has. All seven or none.
  const banded = days.every((d) => d.p10 != null && d.p90 != null)
  const p10 = days.length > 0 && banded ? days.reduce((s, d) => s + (d.p10 ?? 0), 0) : null
  const p90 = days.length > 0 && banded ? days.reduce((s, d) => s + (d.p90 ?? 0), 0) : null

  // Each day carries its own change against the same weekday last week, so the
  // prior week is recoverable without a second query: predicted / (1 + pct).
  // Same all-or-none rule as the band — a week compared on five of seven days
  // is not a week-over-week number.
  const comparable =
    days.length > 0 &&
    days.every((d) => d.pctVsTrailing != null && 1 + d.pctVsTrailing > 0)
  const priorTotal = comparable
    ? days.reduce((s, d) => s + d.predictedRevenue / (1 + (d.pctVsTrailing ?? 0)), 0)
    : null
  const vsPriorWeek =
    total != null && priorTotal != null && priorTotal > 0 ? total / priorTotal - 1 : null

  // ---- labor ---------------------------------------------------------------
  const judged = days.filter((d) => d.labor.gapHours != null)
  const gapHours =
    judged.length > 0 ? round1(judged.reduce((s, d) => s + (d.labor.gapHours ?? 0), 0)) : null

  const neededTotal = days.reduce((s, d) => s + (d.labor.neededHours ?? 0), 0)
  const scheduledTotal = days.reduce((s, d) => s + d.labor.scheduledHours, 0)

  // Same tolerance the per-day lane and the SPLH chart use, so all three
  // surfaces flag the same weeks.
  const slack = neededTotal * SPLH_TOLERANCE
  const gapStatus: GapStatus =
    gapHours == null
      ? "unknown"
      : gapHours < -slack
        ? "short"
        : gapHours > slack
          ? "heavy"
          : "level"

  // ---- sales per labor hour ------------------------------------------------
  // needed = revenue / targetSplh, so targetSplh = revenue / needed. Recovering
  // it this way keeps the cell and the lane quoting the same target even if
  // weekdayTargets() changes underneath them.
  const actual = total != null && scheduledTotal > 0 ? total / scheduledTotal : null
  const target = total != null && neededTotal > 0 ? total / neededTotal : null

  const rateStatus: RateStatus =
    actual == null || target == null
      ? "unknown"
      : actual > target * (1 + SPLH_TOLERANCE)
        ? "above"
        : actual < target * (1 - SPLH_TOLERANCE)
          ? "below"
          : "level"

  return {
    weekForecast: { total, p10, p90, daysCounted: days.length, vsPriorWeek },
    laborGap: {
      hours: gapHours,
      status: gapStatus,
      shortDays: days.filter((d) => d.labor.status === "short").length,
      heavyDays: days.filter((d) => d.labor.status === "heavy").length,
      unscheduledDays: days.filter((d) => d.labor.status === "unscheduled").length,
      unfilledSlots: days.reduce((n, d) => n + d.labor.unfilledSlots, 0),
    },
    splh: { actual, target, status: rateStatus },
    // A row with nothing reconciled behind it is informational. Rendering
    // "0.0% miss" off an empty sample is exactly the flattering reading the
    // scorecard exists to prevent.
    accuracy:
      scorecard && scorecard.sampleSize > 0
        ? {
            wape: scorecard.wape,
            beatsBaselineBy: scorecard.beatsBaselineBy,
            sampleSize: scorecard.sampleSize,
          }
        : null,
  }
}

/**
 * The accuracy cell's subtitle, in words that survive a negative number.
 *
 * `beatsBaselineBy` is signed, and on a bad week it is very negative. "beats
 * naive by −89%" is not a sentence — and the scorecard at the foot of the page
 * reads the identical figure as "worse than last week's same day", so the two
 * cannot be allowed to disagree on one screen. Principle #4: the report card is
 * never flattering, which also means it is never incoherent.
 */
export function accuracySubtitle(a: {
  beatsBaselineBy: number | null
  sampleSize: number
}): string {
  if (a.beatsBaselineBy == null) {
    return `avg miss over ${a.sampleSize} day${a.sampleSize === 1 ? "" : "s"}`
  }
  const pct = Math.abs(a.beatsBaselineBy * 100).toFixed(0)
  return a.beatsBaselineBy >= 0
    ? `avg miss · beats a simple guess by ${pct}%`
    : `avg miss · ${pct}% worse than a simple guess`
}
