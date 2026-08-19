/**
 * The forecast's own report card.
 *
 * `MlForecastEvaluation` is written nightly with wape / baselineWape /
 * intervalCoverage80 per store, and until now no file under `src/` read it —
 * the page rendered three grey confidence dots instead. Confidence is earned by
 * showing the track record, including where it misses.
 */

/** Empirical coverage the 80% predictive interval is supposed to hit. */
export const COVERAGE_TARGET = 0.8

/**
 * Coverage is estimated from a few dozen reconciled days, so it wobbles. A
 * couple of points under target is noise, not a failure worth flagging red.
 */
const COVERAGE_TOLERANCE = 0.01

export interface EvaluationRow {
  wape: number | null
  baselineWape: number | null
  intervalCoverage80: number | null
  /** Reconciled rows behind the metrics. Zero means the row is informational. */
  sampleSize: number
}

export interface Scorecard {
  wape: number | null
  baselineWape: number | null
  /** Fraction the model beats the seasonal-naive baseline by. Negative = worse. */
  beatsBaselineBy: number | null
  intervalCoverage80: number | null
  coverageTarget: number
  /** Null when coverage wasn't measured — absent is not the same as failing. */
  coverageMeetsTarget: boolean | null
  sampleSize: number
}

/**
 * Combine one evaluation row per store into a single portfolio reading.
 *
 * Weighted by `sampleSize`, so a store with three reconciled days can't drag
 * the headline number around. Each metric is weighted over only the rows that
 * actually reported it — a missing metric is skipped, never counted as zero.
 */
export function combineEvaluations(rows: EvaluationRow[]): Scorecard | null {
  const scored = rows.filter((r) => r.sampleSize > 0)
  if (scored.length === 0) return null

  const weightedMean = (pick: (r: EvaluationRow) => number | null): number | null => {
    let num = 0
    let den = 0
    for (const r of scored) {
      const v = pick(r)
      if (v == null) continue
      num += v * r.sampleSize
      den += r.sampleSize
    }
    return den > 0 ? num / den : null
  }

  const wape = weightedMean((r) => r.wape)
  const baselineWape = weightedMean((r) => r.baselineWape)
  const intervalCoverage80 = weightedMean((r) => r.intervalCoverage80)

  const beatsBaselineBy =
    wape != null && baselineWape != null && baselineWape > 0
      ? (baselineWape - wape) / baselineWape
      : null

  return {
    wape,
    baselineWape,
    beatsBaselineBy,
    intervalCoverage80,
    coverageTarget: COVERAGE_TARGET,
    coverageMeetsTarget:
      intervalCoverage80 == null
        ? null
        : intervalCoverage80 >= COVERAGE_TARGET - COVERAGE_TOLERANCE,
    sampleSize: scored.reduce((s, r) => s + r.sampleSize, 0),
  }
}
