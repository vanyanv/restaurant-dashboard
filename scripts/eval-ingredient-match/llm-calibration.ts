/**
 * Calibration: does stated confidence predict actual accuracy? Buckets every
 * *resolved* decision (a real candidate picked, whether or not it would clear
 * an acceptance threshold) by confidence, width 0.1, and reports observed
 * accuracy per bucket. This is independent of any acceptance threshold — it
 * answers whether confidence carries information at all, which is the
 * precondition for using it as a gate.
 *
 * No I/O.
 */

import type { LlmResult } from "./llm-resolve"

export type CalibrationBucket = {
  lo: number
  hi: number
  n: number
  correct: number
  accuracyPct: number
}

export type CalibrationSummary = {
  buckets: CalibrationBucket[]
  totalPoolCases: number
  resolved: number
  nullAnswer: number
  hallucinated: number
  missingDraft: number
}

export function computeCalibration(results: LlmResult[]): CalibrationSummary {
  const resolvedResults = results.filter((r) => r.resolvedCanonicalId !== null)
  const nullAnswer = results.filter((r) => !r.missingDraft && !r.hallucinated && r.matchName === null).length
  const hallucinated = results.filter((r) => r.hallucinated).length
  const missingDraft = results.filter((r) => r.missingDraft).length

  const buckets: CalibrationBucket[] = []
  for (let b = 0; b < 10; b++) {
    const lo = round1(b / 10)
    const hi = round1((b + 1) / 10)
    const inBucket = resolvedResults.filter((r) => (b === 9 ? r.confidence >= lo && r.confidence <= hi : r.confidence >= lo && r.confidence < hi))
    const correct = inBucket.filter((r) => r.correct === true).length
    buckets.push({ lo, hi, n: inBucket.length, correct, accuracyPct: inBucket.length > 0 ? (correct / inBucket.length) * 100 : 0 })
  }

  return {
    buckets,
    totalPoolCases: results.length,
    resolved: resolvedResults.length,
    nullAnswer,
    hallucinated,
    missingDraft,
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}
