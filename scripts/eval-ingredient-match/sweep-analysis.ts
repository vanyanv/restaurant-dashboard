/**
 * Pure helpers over ThresholdRow[] / ArmResult[] for report.ts — split out
 * purely to keep report.ts under the 400-line limit. No I/O.
 */

import type { ArmResult, ThresholdRow } from "./arms"

/** Highest-coverage row among wrong===0 rows. Tie-break: tighter thresholds
 * win (higher HIGH, then higher MARGIN) — for a safety gate, equal coverage
 * achieved at a tighter threshold is strictly more robust to score drift. */
export function bestZeroErrorRow(sweep: ThresholdRow[]): ThresholdRow | null {
  const zero = sweep.filter((r) => r.wrong === 0)
  if (zero.length === 0) return null
  return zero.reduce((best, r) => {
    if (r.coveragePct !== best.coveragePct) return r.coveragePct > best.coveragePct ? r : best
    if (r.high !== best.high) return r.high > best.high ? r : best
    return r.margin > best.margin ? r : best
  })
}

/** Used only when no zero-error row exists — the row with the fewest wrong
 * auto-links, tie-broken by highest coverage then tighter thresholds. */
export function minWrongRow(sweep: ThresholdRow[]): ThresholdRow {
  return sweep.reduce((best, r) => {
    if (r.wrong !== best.wrong) return r.wrong < best.wrong ? r : best
    if (r.coveragePct !== best.coveragePct) return r.coveragePct > best.coveragePct ? r : best
    if (r.high !== best.high) return r.high > best.high ? r : best
    return r.margin > best.margin ? r : best
  })
}

export type Diagnostics = {
  total: number
  top1Correct: number
  recallAt10: number
  /** bucket index (score-range width 0.05) -> case count */
  histogram: Map<number, number>
}

/** Threshold-free diagnostics (fix-round-1 point 4): distinguish "the
 * embedding signal is weak" from "the signal is fine but the scores are
 * compressed/shifted relative to the HIGH/MARGIN gate calibrated for it." */
export function computeDiagnostics(results: ArmResult[]): Diagnostics {
  let top1Correct = 0
  let recallAt10 = 0
  const histogram = new Map<number, number>()
  for (const r of results) {
    const top = r.candidates[0]
    if (top && top.canonicalIngredientId === r.expectedCanonicalId) top1Correct++
    if (r.candidates.some((c) => c.canonicalIngredientId === r.expectedCanonicalId)) recallAt10++
    const bucket = Math.max(0, Math.min(19, Math.floor(r.topScore * 20)))
    histogram.set(bucket, (histogram.get(bucket) ?? 0) + 1)
  }
  return { total: results.length, top1Correct, recallAt10, histogram }
}

export function pct(n: number, total: number): string {
  return total > 0 ? ((n / total) * 100).toFixed(1) : "0.0"
}
