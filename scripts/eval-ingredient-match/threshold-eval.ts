/**
 * Recompute decisions for a *specific* (HIGH, MARGIN) pair from each case's
 * already-captured candidate list, via the real `classifyCandidates` — never
 * a hand-rolled reimplementation of its logic. Used by:
 *   - arms.ts#sweepThresholds (every grid point)
 *   - holdout-analysis.ts (apply tuning-selected thresholds to the holdout half)
 *   - report-holdout.ts (frontier wrong-case detail, duplicate-creation breakdown)
 *
 * No I/O.
 */

import type { ArmResult, ThresholdRow } from "./arms"
import { classifyCandidates, THRESHOLDS } from "../../src/lib/ingredient-match-scoring"

/** Aggregate counts for one (HIGH, MARGIN) pair over a set of results. */
export function evaluateAtThreshold(results: ArmResult[], high: number, margin: number): ThresholdRow {
  let autoLinked = 0
  let correct = 0
  let wrong = 0
  for (const r of results) {
    const classification = classifyCandidates(r.candidates, {
      HIGH: high,
      MARGIN: margin,
      FLOOR: THRESHOLDS.FLOOR,
      LLM_ACCEPT: THRESHOLDS.LLM_ACCEPT,
    })
    if (classification.kind === "auto") {
      autoLinked++
      if (classification.candidate.canonicalIngredientId === r.expectedCanonicalId) correct++
      else wrong++
    }
  }
  const coveragePct = results.length > 0 ? (autoLinked / results.length) * 100 : 0
  const precisionPct = autoLinked > 0 ? (correct / autoLinked) * 100 : 0
  return { high, margin, autoLinked, correct, wrong, coveragePct, precisionPct }
}

export type WrongCaseAtThreshold = { result: ArmResult; chosenId: string; isTie: boolean }

/** Every case that auto-links to the *wrong* canonical at this specific
 * threshold pair, with whether the wrong pick was a score tie against the
 * expected canonical (i.e. decided only by the deterministic secondary
 * sort, not by the embedding/heuristic actually preferring it). */
export function wrongCasesAtThreshold(results: ArmResult[], high: number, margin: number): WrongCaseAtThreshold[] {
  const out: WrongCaseAtThreshold[] = []
  for (const r of results) {
    const classification = classifyCandidates(r.candidates, {
      HIGH: high,
      MARGIN: margin,
      FLOOR: THRESHOLDS.FLOOR,
      LLM_ACCEPT: THRESHOLDS.LLM_ACCEPT,
    })
    if (classification.kind !== "auto") continue
    if (classification.candidate.canonicalIngredientId === r.expectedCanonicalId) continue
    const expectedCandidate = r.candidates.find((c) => c.canonicalIngredientId === r.expectedCanonicalId)
    const isTie = expectedCandidate !== undefined && expectedCandidate.score === classification.candidate.score
    out.push({ result: r, chosenId: classification.candidate.canonicalIngredientId, isTie })
  }
  return out
}

export type Breakdown = {
  autoCorrect: number
  autoWrong: number
  ambiguous: number
  newCount: number
  /** Every case classified "new" — in this gold set, every case has a real
   * existing correct canonical, so a "new" decision means auto-creating a
   * duplicate of something already in the pantry. Not itself "wrong" in the
   * auto-link sense (it's an abstention from linking), but 100% of it is a
   * wrong *create* decision if auto-create is ever wired to "new". */
  newCases: ArmResult[]
}

/** Breakdown at an arbitrary (HIGH, MARGIN) pair, via the real classifier. */
export function breakdownAtThreshold(results: ArmResult[], high: number, margin: number): Breakdown {
  let autoCorrect = 0
  let autoWrong = 0
  let ambiguous = 0
  const newCases: ArmResult[] = []
  for (const r of results) {
    const classification = classifyCandidates(r.candidates, {
      HIGH: high,
      MARGIN: margin,
      FLOOR: THRESHOLDS.FLOOR,
      LLM_ACCEPT: THRESHOLDS.LLM_ACCEPT,
    })
    if (classification.kind === "auto") {
      if (classification.candidate.canonicalIngredientId === r.expectedCanonicalId) autoCorrect++
      else autoWrong++
    } else if (classification.kind === "ambiguous") {
      ambiguous++
    } else {
      newCases.push(r)
    }
  }
  return { autoCorrect, autoWrong, ambiguous, newCount: newCases.length, newCases }
}

/** Same breakdown, but from each result's own already-computed `decision`
 * field instead of re-running classifyCandidates — this is the arm's
 * *default* policy (THRESHOLDS defaults for vector arms; the 0.25 Jaccard
 * cutoff for token-overlap, which has no HIGH/MARGIN concept at all). */
export function breakdownFromResults(results: ArmResult[]): Breakdown {
  let autoCorrect = 0
  let autoWrong = 0
  let ambiguous = 0
  const newCases: ArmResult[] = []
  for (const r of results) {
    if (r.decision === "auto") {
      if (r.correct) autoCorrect++
      else autoWrong++
    } else if (r.decision === "ambiguous") {
      ambiguous++
    } else {
      newCases.push(r)
    }
  }
  return { autoCorrect, autoWrong, ambiguous, newCount: newCases.length, newCases }
}
