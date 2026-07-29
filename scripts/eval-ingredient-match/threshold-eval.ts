/**
 * Recompute decisions for a *specific* (HIGH, MARGIN) pair from each case's
 * already-captured candidate list, via the real `classifyCandidates` — never
 * a hand-rolled reimplementation of its logic. Used by:
 *   - arms.ts#sweepThresholds (every grid point)
 *   - holdout-analysis.ts (apply tuning-selected thresholds to held-out folds)
 *   - report-holdout.ts / report-duplicate-create.ts (frontier detail,
 *     wrong-create breakdowns, the FLOOR sweep)
 *
 * No I/O.
 */

import type { ArmResult, ThresholdRow } from "./arms"
import { classifyCandidates, THRESHOLDS } from "../../src/lib/ingredient-match-scoring"

/**
 * FLOOR is a *swept* parameter here, not a constant (round-4, point 5). It
 * used to be hardcoded to `THRESHOLDS.FLOOR` in every classification path,
 * which meant the FLOOR sweep could only ever report the duplicate-create
 * count (derivable from `topScore` alone) and never the auto-link
 * precision/coverage that changing FLOOR actually buys or costs. Every
 * function below now takes it explicitly, defaulting to production's value so
 * existing call sites keep their old meaning.
 */
function thresholdSet(high: number, margin: number, floor: number) {
  return { HIGH: high, MARGIN: margin, FLOOR: floor, LLM_ACCEPT: THRESHOLDS.LLM_ACCEPT }
}

/** Aggregate counts for one (HIGH, MARGIN, FLOOR) triple over a set of results. */
export function evaluateAtThreshold(
  results: ArmResult[],
  high: number,
  margin: number,
  floor: number = THRESHOLDS.FLOOR,
): ThresholdRow {
  let autoLinked = 0
  let correct = 0
  let wrong = 0
  for (const r of results) {
    const classification = classifyCandidates(r.candidates, thresholdSet(high, margin, floor))
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
export function wrongCasesAtThreshold(
  results: ArmResult[],
  high: number,
  margin: number,
  floor: number = THRESHOLDS.FLOOR,
): WrongCaseAtThreshold[] {
  const out: WrongCaseAtThreshold[] = []
  for (const r of results) {
    const classification = classifyCandidates(r.candidates, thresholdSet(high, margin, floor))
    if (classification.kind !== "auto") continue
    if (classification.candidate.canonicalIngredientId === r.expectedCanonicalId) continue
    const expectedCandidate = r.candidates.find((c) => c.canonicalIngredientId === r.expectedCanonicalId)
    const isTie = expectedCandidate !== undefined && expectedCandidate.score === classification.candidate.score
    out.push({ result: r, chosenId: classification.candidate.canonicalIngredientId, isTie })
  }
  return out
}

/**
 * Case lists per decision bucket (not just counts) — callers derive counts
 * via `.length` and occurrence-weighted sums by looking each case up in
 * GoldCase. `newCases` (= "new") is the duplicate-create bucket: every gold
 * case has a real existing correct canonical, so every "new" decision here
 * would, in production, auto-create a duplicate of something already in the
 * pantry rather than abstaining safely (unlike `ambiguousCases`, which is
 * safe — it goes to human review).
 */
export type Breakdown = {
  autoCorrectCases: ArmResult[]
  autoWrongCases: ArmResult[]
  ambiguousCases: ArmResult[]
  newCases: ArmResult[]
}

/** Breakdown at an arbitrary (HIGH, MARGIN, FLOOR) triple, via the real classifier. */
export function breakdownAtThreshold(
  results: ArmResult[],
  high: number,
  margin: number,
  floor: number = THRESHOLDS.FLOOR,
): Breakdown {
  const b: Breakdown = { autoCorrectCases: [], autoWrongCases: [], ambiguousCases: [], newCases: [] }
  for (const r of results) {
    const classification = classifyCandidates(r.candidates, thresholdSet(high, margin, floor))
    if (classification.kind === "auto") {
      if (classification.candidate.canonicalIngredientId === r.expectedCanonicalId) b.autoCorrectCases.push(r)
      else b.autoWrongCases.push(r)
    } else if (classification.kind === "ambiguous") {
      b.ambiguousCases.push(r)
    } else {
      b.newCases.push(r)
    }
  }
  return b
}

/** Same breakdown, but from each result's own already-computed `decision`
 * field instead of re-running classifyCandidates — this is the arm's
 * *default* policy (THRESHOLDS defaults for vector arms; the 0.25 Jaccard
 * cutoff for token-overlap, which has no HIGH/MARGIN concept at all). */
export function breakdownFromResults(results: ArmResult[]): Breakdown {
  const b: Breakdown = { autoCorrectCases: [], autoWrongCases: [], ambiguousCases: [], newCases: [] }
  for (const r of results) {
    if (r.decision === "auto") {
      if (r.correctAtDefaultThresholds) b.autoCorrectCases.push(r)
      else b.autoWrongCases.push(r)
    } else if (r.decision === "ambiguous") {
      b.ambiguousCases.push(r)
    } else {
      b.newCases.push(r)
    }
  }
  return b
}

/**
 * The cases that would classify as "new" at a given FLOOR value, computed
 * directly from stored `topScore` — no HIGH/MARGIN needed, and deliberately
 * not routed through `classifyCandidates`. This is not a shortcut: reading
 * `classifyCandidates`'s own source shows "new" fires purely from
 * `top.score < FLOOR`, checked *before* HIGH or MARGIN are ever consulted.
 * So the duplicate-create count is a function of FLOOR alone — HIGH and
 * MARGIN cannot move it at all, at any value. That structural fact is why a
 * FLOOR sweep (report-duplicate-create.ts) is the only sweep that actually
 * answers "what would it take to bring duplicate-creates to zero."
 */
export function newCasesAtFloor(results: ArmResult[], floor: number): ArmResult[] {
  return results.filter((r) => r.topScore < floor)
}
