/**
 * The week ribbon's geometry — Act II of the docket.
 *
 * The week used to render as seven detached boxes carrying an adjective
 * ("busy") and a staff arrow. The redesign draws it as one object: seven
 * hairline-seamed columns of forecast revenue, each with its 80% band drawn on
 * the same axis, over a labor lane. This module owns the arithmetic that turns
 * dollars into heights so the component owns nothing but markup — and so the
 * one rule that matters (the whisker and the column share a scale) is testable
 * rather than trusted.
 */

import type { LaborLaneStatus } from "./labor-lane"

/** A mono chip under the column: EVENT, RAIN, HOT, COLD, FLAG, "2 OPEN". */
export interface RibbonSignal {
  label: string
  /** Red. Earned, never decorative — see `signalsFor`. */
  hot: boolean
}

export interface RibbonCell {
  date: string
  /** Height of the revenue column, as a percentage of the track. */
  barPct: number
  /**
   * The p10–p90 whisker. Percentages are against the *column's own* height,
   * not the track's, because the whisker is positioned inside the column —
   * `topPct` is negative when p90 sits above the forecast, which is the normal
   * case. Null when the day carries no band.
   */
  whisker: { topPct: number; heightPct: number } | null
  /** The single biggest day of the week. */
  isPeak: boolean
  signals: RibbonSignal[]
}

export interface Ribbon {
  /** The dollar value at the top of the track. */
  scaleMax: number
  cells: RibbonCell[]
}

export interface RibbonDay {
  date: string
  predictedRevenue: number
  p10: number | null
  p90: number | null
  labor: { status: LaborLaneStatus; unfilledSlots: number }
  weatherTone: "clear" | "rain" | "heat" | "cold" | "heavy_rain" | null
  hasAnomaly: boolean
  topEventTitle: string | null
}

/** Below this a column reads as a rule rather than a bar. */
const MIN_BAR_PCT = 2

export function computeRibbon(days: RibbonDay[]): Ribbon {
  if (days.length === 0) return { scaleMax: 0, cells: [] }

  // The top of the track is the highest point any day could reach, not the
  // highest forecast. Scaling to the forecasts alone would push every upper
  // whisker cap off the top of the chart, which is exactly the information the
  // band exists to carry.
  const scaleMax = days.reduce(
    (m, d) => Math.max(m, d.p90 ?? d.predictedRevenue),
    0,
  )

  const peakRevenue = days.reduce((m, d) => Math.max(m, d.predictedRevenue), 0)
  // Ties go to the earlier day: two days at the same forecast is not two peaks,
  // and the verdict above names one day.
  const peakDate =
    peakRevenue > 0
      ? (days.find((d) => d.predictedRevenue === peakRevenue)?.date ?? null)
      : null

  return {
    scaleMax,
    cells: days.map((d) => {
      const isPeak = d.date === peakDate
      return {
        date: d.date,
        barPct:
          scaleMax > 0
            ? Math.max(
                MIN_BAR_PCT,
                Math.min(100, (d.predictedRevenue / scaleMax) * 100),
              )
            : 0,
        whisker: whiskerFor(d),
        isPeak,
        signals: signalsFor(d, isPeak),
      }
    }),
  }
}

function whiskerFor(d: RibbonDay): RibbonCell["whisker"] {
  if (d.p10 == null || d.p90 == null) return null
  if (d.p90 <= d.p10) return null
  // Everything below is a ratio against the forecast, so a zero or negative
  // forecast has no column to hang a whisker on.
  if (d.predictedRevenue <= 0) return null

  return {
    topPct: -((d.p90 - d.predictedRevenue) / d.predictedRevenue) * 100,
    heightPct: ((d.p90 - d.p10) / d.predictedRevenue) * 100,
  }
}

function signalsFor(d: RibbonDay, isPeak: boolean): RibbonSignal[] {
  // Earn-the-red. A weather or event chip is only a state worth the proofmark
  // on the day the verdict already named — the peak — and only when that day is
  // short of the hours it earns. One red day in the week, or none. Reddening
  // every signal on every short day turns the ribbon into a warning light.
  const hot = isPeak && d.labor.status === "short"

  const out: RibbonSignal[] = []
  if (d.topEventTitle) out.push({ label: "EVENT", hot })
  if (d.weatherTone === "rain" || d.weatherTone === "heavy_rain") {
    out.push({ label: "RAIN", hot })
  }
  if (d.weatherTone === "heat") out.push({ label: "HOT", hot })
  if (d.weatherTone === "cold") out.push({ label: "COLD", hot })
  if (d.hasAnomaly) out.push({ label: "FLAG", hot })

  // Unfilled shifts are rare enough (11 of 3,737 over thirteen months) to earn
  // the accent wherever they land, peak day or not.
  if (d.labor.unfilledSlots > 0) {
    out.push({ label: `${d.labor.unfilledSlots} OPEN`, hot: true })
  }

  return out
}
