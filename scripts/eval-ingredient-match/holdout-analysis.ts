/**
 * Tuning/holdout split so the ship-gate threshold is never selected on the
 * same cases it's scored on. Without this, "zero errors" at a threshold
 * chosen because it's exactly where the last observed error disappears is a
 * point estimate at a single observation's boundary, not a property of the
 * strategy (fix-round-2, point 1).
 *
 * No I/O, no Math.random() — the split is a deterministic function of each
 * case's id, so it's identical on every run without being persisted anywhere.
 */

import type { GoldCase } from "./gold"
import type { ArmResult, ThresholdRow } from "./arms"
import { sweepThresholds, round2 } from "./arms"
import { bestZeroErrorRow, minWrongRow } from "./sweep-analysis"
import { evaluateAtThreshold, wrongCasesAtThreshold, type WrongCaseAtThreshold } from "./threshold-eval"

export type Split = { tuningIds: Set<string>; holdoutIds: Set<string> }

/**
 * FNV-1a 32-bit hash — deterministic, dependency-free, good enough
 * distribution for a 50/50 split of ~260 short id strings. Not
 * cryptographic; doesn't need to be.
 */
function stableHash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Deterministic ~50/50 partition of gold case ids, by (stableHash(id) % 2).
 * Same split every run, on every machine, forever — no seed to lose track of. */
export function splitCaseIds(caseIds: string[]): Split {
  const tuningIds = new Set<string>()
  const holdoutIds = new Set<string>()
  for (const id of caseIds) {
    if (stableHash(id) % 2 === 0) tuningIds.add(id)
    else holdoutIds.add(id)
  }
  return { tuningIds, holdoutIds }
}

export type HoldoutAnalysis = {
  split: Split
  tuningCount: number
  holdoutCount: number
  /** Full sweep computed on the tuning half only — thresholds are selected
   * from this, never from the full 260 or the holdout half. */
  tuningSweep: ThresholdRow[]
  /** The row selected on the tuning half: the highest-coverage zero-error
   * row if one exists there, else the fewest-wrong row. */
  shipGate: ThresholdRow
  shipGateIsZeroError: boolean
  /** shipGate's exact (HIGH, MARGIN) applied, unchanged, to the holdout half. */
  holdoutAtShipGate: ThresholdRow
  /** The adjacent looser-MARGIN row (same HIGH, MARGIN - 0.01) from the
   * tuning sweep, and its wrong cases — only populated when shipGate is a
   * zero-error row, since that's the case where "the frontier is one case
   * wide" and that case would otherwise never be shown (fix-round-2, point 3). */
  frontier: { row: ThresholdRow; wrongCases: WrongCaseAtThreshold[] } | null
}

export function analyzeHoldout(cases: GoldCase[], results: ArmResult[]): HoldoutAnalysis {
  const split = splitCaseIds(cases.map((c) => c.id))
  const tuningResults = results.filter((r) => split.tuningIds.has(r.caseId))
  const holdoutResults = results.filter((r) => split.holdoutIds.has(r.caseId))

  const tuningSweep = sweepThresholds(tuningResults)
  const zeroErrorRow = bestZeroErrorRow(tuningSweep)
  const shipGate = zeroErrorRow ?? minWrongRow(tuningSweep)
  const shipGateIsZeroError = zeroErrorRow !== null

  const holdoutAtShipGate = evaluateAtThreshold(holdoutResults, shipGate.high, shipGate.margin)

  let frontier: HoldoutAnalysis["frontier"] = null
  if (shipGateIsZeroError) {
    const looserMargin = round2(shipGate.margin - 0.01)
    if (looserMargin >= 0) {
      const looserRow = tuningSweep.find((r) => r.high === shipGate.high && r.margin === looserMargin)
      if (looserRow && looserRow.wrong > 0) {
        frontier = {
          row: looserRow,
          wrongCases: wrongCasesAtThreshold(tuningResults, looserRow.high, looserRow.margin),
        }
      }
    }
  }

  return {
    split,
    tuningCount: tuningResults.length,
    holdoutCount: holdoutResults.length,
    tuningSweep,
    shipGate,
    shipGateIsZeroError,
    holdoutAtShipGate,
    frontier,
  }
}
