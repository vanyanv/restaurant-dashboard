/**
 * Confidence-threshold sweep over stored LlmResult[] — the LLM-arm analogue
 * of threshold-eval.ts's (HIGH, MARGIN) sweep. A case is "accepted" at
 * threshold tau iff it resolved to a real candidate (not null, not
 * hallucinated) AND confidence >= tau. Every call reads only already-stored
 * `confidence`/`resolvedCanonicalId` fields — never re-queries the model, per
 * the brief's "sweep the threshold offline" requirement.
 *
 * No I/O.
 */

import type { LlmResult } from "./llm-resolve"

export type ConfidenceRow = {
  tau: number
  accepted: number
  correct: number
  wrong: number
  coveragePct: number
  precisionPct: number
}

export function evaluateAtConfidence(results: LlmResult[], tau: number): ConfidenceRow {
  let accepted = 0
  let correct = 0
  let wrong = 0
  for (const r of results) {
    if (r.resolvedCanonicalId === null) continue
    if (r.confidence < tau) continue
    accepted++
    if (r.correct) correct++
    else wrong++
  }
  const coveragePct = results.length > 0 ? (accepted / results.length) * 100 : 0
  const precisionPct = accepted > 0 ? (correct / accepted) * 100 : 0
  return { tau, accepted, correct, wrong, coveragePct, precisionPct }
}

/** tau 0.00 .. 1.00, step 0.01 — the full range confidence is documented to
 * take (buildAdjudicatorPrompt asks for 0.0-1.0). */
export function sweepConfidence(results: LlmResult[]): ConfidenceRow[] {
  const rows: ConfidenceRow[] = []
  for (let i = 0; i <= 100; i++) {
    rows.push(evaluateAtConfidence(results, round2(i / 100)))
  }
  return rows
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export type WrongAtConfidence = { result: LlmResult }

export function wrongCasesAtConfidence(results: LlmResult[], tau: number): WrongAtConfidence[] {
  return results
    .filter((r) => r.resolvedCanonicalId !== null && r.confidence >= tau && r.correct === false)
    .map((result) => ({ result }))
}

/** Highest-accepted-count row among wrong===0 rows; tighter (higher) tau wins ties. */
export function bestZeroErrorConfidenceRow(sweep: ConfidenceRow[]): ConfidenceRow | null {
  const zero = sweep.filter((r) => r.wrong === 0)
  if (zero.length === 0) return null
  return zero.reduce((best, r) => {
    if (r.accepted !== best.accepted) return r.accepted > best.accepted ? r : best
    return r.tau > best.tau ? r : best
  })
}

/** Used only when no zero-error row exists on a fold's tuning half. */
export function minWrongConfidenceRow(sweep: ConfidenceRow[]): ConfidenceRow {
  return sweep.reduce((best, r) => {
    if (r.wrong !== best.wrong) return r.wrong < best.wrong ? r : best
    if (r.accepted !== best.accepted) return r.accepted > best.accepted ? r : best
    return r.tau > best.tau ? r : best
  })
}
