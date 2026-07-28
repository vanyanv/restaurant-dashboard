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

const Z_95 = 1.959964

/**
 * Wilson score interval upper bound (95% confidence) on the true error rate,
 * given `wrong` observed errors out of `n` trials. Standard closed-form
 * Wilson formula (no continuity correction) — well-defined at wrong=0 with
 * no special-casing needed (the sqrt term never goes negative there).
 *
 * This exists because "0 wrong out of 147" is a point estimate at a sample
 * boundary, not a proof of zero error rate — rule of three approximates the
 * same thing as ~3/n. At n=1 (e.g. vector-only's own default policy, which
 * auto-links exactly 1 case) this upper bound is close to 80%, which is the
 * point: a "0 wrong" claim on a tiny sample asserts almost nothing.
 */
export function wilsonUpper95(wrong: number, n: number): number {
  if (n <= 0) return 1
  const z2 = Z_95 * Z_95
  const phat = wrong / n
  const denom = 1 + z2 / n
  const center = phat + z2 / (2 * n)
  const halfWidth = Z_95 * Math.sqrt(phat * (1 - phat) / n + z2 / (4 * n * n))
  return Math.min(1, (center + halfWidth) / denom)
}
