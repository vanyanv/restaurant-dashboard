/**
 * Grouped k-fold cross-validation for the LLM confidence-acceptance
 * threshold, mirroring holdout-analysis.ts's methodology for vector-only's
 * (HIGH, MARGIN) gate: no canonical appears in both a fold's tuning and
 * held-out portion; each fold selects its threshold from its own tuning
 * portion only and applies it, unchanged, to that fold's held-out canonicals;
 * folds are pooled. Reuses `buildFoldMap`/`K` from holdout-analysis.ts so
 * fold assignment is identical to the vector arm's — the same canonical
 * always lands in the same fold regardless of which arm is being scored.
 *
 * The vector-only contribution is FIXED (not re-tuned here) — this task's
 * vector ship gate was already selected and cross-validated in the Step-0
 * baseline. Only the LLM's confidence threshold is tuned/held-out per fold.
 * A fold's held-out combined result = that fold's fixed vector auto-links
 * (whichever canonicals fall in this fold) + the LLM's own held-out
 * acceptances at this fold's own threshold.
 *
 * No I/O, no Math.random().
 */

import type { GoldCase } from "./gold"
import type { ArmResult } from "./arms"
import type { LlmResult } from "./llm-resolve"
import { buildFoldMap, K } from "./holdout-analysis"
import {
  sweepConfidence,
  evaluateAtConfidence,
  bestZeroErrorConfidenceRow,
  minWrongConfidenceRow,
  wrongCasesAtConfidence,
  type ConfidenceRow,
  type WrongAtConfidence,
} from "./llm-threshold-eval"

export type CombinedBucket = { autoLinked: number; correct: number; wrong: number }

/**
 * BUG FIXED (found during report review): this used to take one merged
 * `vectorFixedAuto: ArmResult[]` and split correct/wrong by filtering on
 * `r.correct === true` / `=== false`. That field is stale — it was baked in
 * by `resolveViaVectorSearch` (arms.ts) at the *production default*
 * thresholds (HIGH=0.9, MARGIN=0.05), where almost nothing auto-links (1/255
 * cases). `splitPool` (llm-pool.ts) reclassifies every case at the actual
 * ship gate via `breakdownAtThreshold`, which computes correctness fresh and
 * bucket-sorts into `vectorAutoCorrect`/`vectorAutoWrong` — but the objects'
 * own `.correct` field is left untouched, still `null` or reflecting the
 * default-gate decision. Filtering on that stale field silently dropped
 * nearly the entire vector contribution to "correct," which corrupted every
 * arm's pooled "Correct"/"Precision" figure (e.g. gpt-5.5 read 20/187 =
 * 10.7% "precision" instead of the true 186/187 = 99.5%) while "Coverage"
 * stayed right (it only ever counted array length) and "Wrong" happened to
 * read right only because the true vector-wrong count is 0 in this run.
 *
 * Fix: take the two *already-bucketed* arrays directly — array membership in
 * `vectorAutoCorrect`/`vectorAutoWrong` IS the ship-gate ground truth, so no
 * field needs re-checking.
 */
function fixedVectorForFold(
  vectorFixedCorrect: ArmResult[],
  vectorFixedWrong: ArmResult[],
  foldByCanonical: Map<string, number>,
  foldIndex: number,
): { bucket: CombinedBucket; correctCases: ArmResult[]; wrongCases: ArmResult[] } {
  const correctCases = vectorFixedCorrect.filter((r) => foldByCanonical.get(r.expectedCanonicalId) === foldIndex)
  const wrongCases = vectorFixedWrong.filter((r) => foldByCanonical.get(r.expectedCanonicalId) === foldIndex)
  return {
    bucket: { autoLinked: correctCases.length + wrongCases.length, correct: correctCases.length, wrong: wrongCases.length },
    correctCases,
    wrongCases,
  }
}

export type LlmFold = {
  index: number
  heldOutCanonicalCount: number
  tuningPoolCount: number
  holdoutPoolCount: number
  tuningSweep: ConfidenceRow[]
  ownSelectionTau: number
  ownSelectionIsZeroError: boolean
  llmHoldoutAtTau: ConfidenceRow
  vectorFixedHoldout: CombinedBucket
  combinedHoldout: CombinedBucket & { total: number; coveragePct: number; precisionPct: number }
}

export type LlmGroupedKFoldAnalysis = {
  k: number
  totalDistinctCanonicals: number
  totalCasesAllGold: number
  folds: LlmFold[]
  /** The real combined figures — vector's fixed contribution PLUS the LLM's
   * cross-validated accepts, added together correctly (see the bug note on
   * fixedVectorForFold above). `correct`/`wrong`/`precisionPct` here are the
   * true combined numbers, not the LLM's contribution alone. */
  pooledCombined: CombinedBucket & { total: number; coveragePct: number; precisionPct: number }
  /** The LLM's OWN contribution only — reported alongside pooledCombined so
   * "how much of the coverage gain is the LLM's doing" is never confused
   * with "what is the combined precision." */
  pooledLlmOnly: { accepted: number; correct: number; wrong: number }
  pooledCombinedAcceptedCanonicals: Set<string>
  pooledCombinedWrongCanonicals: Set<string>
  pooledWrongLlmCases: WrongAtConfidence[]
  pooledWrongVectorCases: ArmResult[]
}

export function analyzeLlmGroupedKFold(
  allCases: GoldCase[],
  vectorFixedCorrect: ArmResult[],
  vectorFixedWrong: ArmResult[],
  poolLlmResults: LlmResult[],
): LlmGroupedKFoldAnalysis {
  const foldByCanonical = buildFoldMap(allCases)
  const allCanonicals = new Set(allCases.map((c) => c.expectedCanonicalId))

  const folds: LlmFold[] = []
  let pooledAuto = 0
  let pooledCorrect = 0
  let pooledWrong = 0
  let pooledTotal = 0
  let pooledLlmAccepted = 0
  let pooledLlmCorrect = 0
  let pooledLlmWrong = 0
  const pooledWrongLlmCases: WrongAtConfidence[] = []
  const pooledWrongVectorCases: ArmResult[] = []
  const acceptedCanon = new Set<string>()
  const wrongCanon = new Set<string>()

  for (let i = 0; i < K; i++) {
    const tuningPool = poolLlmResults.filter((r) => foldByCanonical.get(r.expectedCanonicalId) !== i)
    const holdoutPool = poolLlmResults.filter((r) => foldByCanonical.get(r.expectedCanonicalId) === i)
    const { bucket: vectorFixedHoldout, correctCases: vectorHoldoutCorrect, wrongCases: vectorHoldoutWrong } =
      fixedVectorForFold(vectorFixedCorrect, vectorFixedWrong, foldByCanonical, i)
    const vectorHoldoutCases = [...vectorHoldoutCorrect, ...vectorHoldoutWrong]

    const heldOutCanonicalCount = new Set([
      ...holdoutPool.map((r) => r.expectedCanonicalId),
      ...vectorHoldoutCases.map((r) => r.expectedCanonicalId),
    ]).size
    if (heldOutCanonicalCount === 0) continue

    const tuningSweep = sweepConfidence(tuningPool)
    const zeroRow = bestZeroErrorConfidenceRow(tuningSweep)
    const ownSelection = zeroRow ?? minWrongConfidenceRow(tuningSweep)

    const llmHoldoutAtTau = evaluateAtConfidence(holdoutPool, ownSelection.tau)
    const wrongHoldout = wrongCasesAtConfidence(holdoutPool, ownSelection.tau)

    const combinedAuto = vectorFixedHoldout.autoLinked + llmHoldoutAtTau.accepted
    const combinedCorrect = vectorFixedHoldout.correct + llmHoldoutAtTau.correct
    const combinedWrong = vectorFixedHoldout.wrong + llmHoldoutAtTau.wrong
    const foldTotalCases = vectorHoldoutCases.length + holdoutPool.length

    folds.push({
      index: i,
      heldOutCanonicalCount,
      tuningPoolCount: tuningPool.length,
      holdoutPoolCount: holdoutPool.length,
      tuningSweep,
      ownSelectionTau: ownSelection.tau,
      ownSelectionIsZeroError: zeroRow !== null,
      llmHoldoutAtTau,
      vectorFixedHoldout,
      combinedHoldout: {
        autoLinked: combinedAuto,
        correct: combinedCorrect,
        wrong: combinedWrong,
        total: foldTotalCases,
        coveragePct: foldTotalCases > 0 ? (combinedAuto / foldTotalCases) * 100 : 0,
        precisionPct: combinedAuto > 0 ? (combinedCorrect / combinedAuto) * 100 : 0,
      },
    })

    pooledAuto += combinedAuto
    pooledCorrect += combinedCorrect
    pooledWrong += combinedWrong
    pooledTotal += foldTotalCases
    pooledLlmAccepted += llmHoldoutAtTau.accepted
    pooledLlmCorrect += llmHoldoutAtTau.correct
    pooledLlmWrong += llmHoldoutAtTau.wrong
    pooledWrongLlmCases.push(...wrongHoldout)
    pooledWrongVectorCases.push(...vectorHoldoutWrong)

    for (const r of vectorHoldoutCases) acceptedCanon.add(r.expectedCanonicalId)
    for (const r of holdoutPool) if (r.resolvedCanonicalId !== null && r.confidence >= ownSelection.tau) acceptedCanon.add(r.expectedCanonicalId)
    for (const r of vectorHoldoutWrong) wrongCanon.add(r.expectedCanonicalId)
    for (const w of wrongHoldout) wrongCanon.add(w.result.expectedCanonicalId)
  }

  return {
    k: K,
    totalDistinctCanonicals: allCanonicals.size,
    totalCasesAllGold: pooledTotal,
    folds,
    pooledCombined: {
      autoLinked: pooledAuto,
      correct: pooledCorrect,
      wrong: pooledWrong,
      total: pooledTotal,
      coveragePct: pooledTotal > 0 ? (pooledAuto / pooledTotal) * 100 : 0,
      precisionPct: pooledAuto > 0 ? (pooledCorrect / pooledAuto) * 100 : 0,
    },
    pooledLlmOnly: { accepted: pooledLlmAccepted, correct: pooledLlmCorrect, wrong: pooledLlmWrong },
    pooledCombinedAcceptedCanonicals: acceptedCanon,
    pooledCombinedWrongCanonicals: wrongCanon,
    pooledWrongLlmCases,
    pooledWrongVectorCases,
  }
}
