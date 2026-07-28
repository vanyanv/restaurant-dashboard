/**
 * Grouped k-fold cross-validation by `expectedCanonicalId` (fix-round-3,
 * point 1). 260 cases cover only 68 distinct canonicals (~3.8 spelling
 * variants each), so a plain per-case split lets most of a holdout case's
 * canonical also sit in tuning — "generalizes" would really only mean
 * "transfers to another spelling of the same 68 ingredients," and the
 * effective independent sample is ~68 ingredient families, not 260 cases.
 *
 * Fix: no canonical may appear in both tuning and holdout within a fold.
 * 5 folds, deterministic assignment by a stable hash of the *canonical* id
 * (not the case id — grouping happens at the canonical level). Each fold's
 * threshold is selected on that fold's tuning portion only and applied,
 * unchanged, to that fold's held-out canonicals; folds are then pooled.
 *
 * No I/O, no Math.random().
 */

import type { GoldCase } from "./gold"
import type { ArmResult, ThresholdRow } from "./arms"
import { sweepThresholds, round2 } from "./arms"
import { bestZeroErrorRow, minWrongRow } from "./sweep-analysis"
import {
  evaluateAtThreshold,
  wrongCasesAtThreshold,
  breakdownAtThreshold,
  type WrongCaseAtThreshold,
} from "./threshold-eval"
import { THRESHOLDS } from "../../src/lib/ingredient-match-scoring"

const K = 5
const FLOOR_2DP = round2(THRESHOLDS.FLOOR)

/**
 * FNV-1a 32-bit hash. Multiplying by an odd prime never changes the LSB's
 * parity (odd*even=even, odd*odd=odd), so bit 0 of the final hash is just
 * the XOR-parity of the input's odd-valued bytes — a low-entropy bit that
 * forces near-identical strings (e.g. two id-adjacent canonicals, or two
 * strings differing only in even-valued characters) toward correlated,
 * non-random bucket assignments instead of independent ones. Fold
 * assignment below reads bit 16 upward for that reason, never bit 0.
 */
function stableHash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function foldOf(canonicalId: string): number {
  return (stableHash(canonicalId) >>> 16) % K
}

export type FrontierProbe = {
  direction: "HIGH" | "MARGIN"
  row: ThresholdRow | null
  /** Set instead of `row` when the looser value is out of the valid range —
   * e.g. HIGH can't go below FLOOR, which is a structural floor of
   * classifyCandidates, not a sweep-grid artifact. */
  outOfRangeReason: string | null
  wrongCases: WrongCaseAtThreshold[]
}

export type Fold = {
  index: number
  holdoutCanonicalCount: number
  tuningSweep: ThresholdRow[]
  shipGate: ThresholdRow
  shipGateIsZeroError: boolean
  holdoutAtShipGate: ThresholdRow
  holdoutAutoLinkedDistinctCanonicals: number
  holdoutWrongDistinctCanonicals: number
  /** Only populated when shipGateIsZeroError — a fewest-wrong row's own
   * wrong-case list is already visible and non-empty, so there's nothing a
   * frontier probe would add. */
  frontier: FrontierProbe[]
}

export type GroupedKFoldAnalysis = {
  k: number
  totalDistinctCanonicals: number
  folds: Fold[]
  pooled: ThresholdRow
  pooledAutoLinkedDistinctCanonicals: number
  pooledWrongDistinctCanonicals: number
  pooledWrongCases: WrongCaseAtThreshold[]
  /** Case lists (not just counts) across all folds' holdout evaluations, for
   * occurrence-weighted coverage/precision (fix-round-3, point 2). */
  pooledAutoLinkedCases: ArmResult[]
  pooledCorrectCases: ArmResult[]
}

function distinctCanonicalCount(results: ArmResult[]): number {
  return new Set(results.map((r) => r.expectedCanonicalId)).size
}

function probeDirection(
  direction: "HIGH" | "MARGIN",
  tuningResults: ArmResult[],
  tuningSweep: ThresholdRow[],
  shipGate: ThresholdRow,
): FrontierProbe {
  if (direction === "HIGH") {
    const looser = round2(shipGate.high - 0.01)
    if (looser < FLOOR_2DP) {
      return {
        direction,
        row: null,
        outOfRangeReason:
          `HIGH cannot go below FLOOR (${THRESHOLDS.FLOOR.toFixed(2)}) — classifyCandidates rejects anything scoring ` +
          "under FLOOR regardless of HIGH, so this is a structural minimum, not a sweep-grid edge. When a ship gate's " +
          "HIGH already equals FLOOR, the HIGH direction contributes nothing further — MARGIN (and FLOOR itself) are " +
          "the only levers still in play.",
        wrongCases: [],
      }
    }
    const row = tuningSweep.find((r) => r.high === looser && r.margin === shipGate.margin)
    if (!row) return { direction, row: null, outOfRangeReason: "No adjacent row found in the tuning sweep.", wrongCases: [] }
    if (row.wrong === 0) return { direction, row, outOfRangeReason: null, wrongCases: [] }
    return { direction, row, outOfRangeReason: null, wrongCases: wrongCasesAtThreshold(tuningResults, row.high, row.margin) }
  }

  const looser = round2(shipGate.margin - 0.01)
  if (looser < 0) {
    return { direction, row: null, outOfRangeReason: "MARGIN cannot go below 0.00.", wrongCases: [] }
  }
  const row = tuningSweep.find((r) => r.high === shipGate.high && r.margin === looser)
  if (!row) return { direction, row: null, outOfRangeReason: "No adjacent row found in the tuning sweep.", wrongCases: [] }
  if (row.wrong === 0) return { direction, row, outOfRangeReason: null, wrongCases: [] }
  return { direction, row, outOfRangeReason: null, wrongCases: wrongCasesAtThreshold(tuningResults, row.high, row.margin) }
}

export function analyzeGroupedKFold(cases: GoldCase[], results: ArmResult[]): GroupedKFoldAnalysis {
  const allCanonicals = new Set(cases.map((c) => c.expectedCanonicalId))
  const foldByCanonical = new Map<string, number>()
  for (const id of allCanonicals) foldByCanonical.set(id, foldOf(id))

  const folds: Fold[] = []
  let pooledAutoLinked = 0
  let pooledCorrect = 0
  let pooledWrong = 0
  let pooledCases = 0
  const pooledWrongCases: WrongCaseAtThreshold[] = []
  const pooledAutoLinkedCanonicals = new Set<string>()
  const pooledWrongCanonicals = new Set<string>()
  const pooledAutoLinkedCases: ArmResult[] = []
  const pooledCorrectCases: ArmResult[] = []

  for (let i = 0; i < K; i++) {
    const tuningResults = results.filter((r) => foldByCanonical.get(r.expectedCanonicalId) !== i)
    const holdoutResults = results.filter((r) => foldByCanonical.get(r.expectedCanonicalId) === i)
    if (holdoutResults.length === 0) continue

    const tuningSweep = sweepThresholds(tuningResults)
    const zeroErrorRow = bestZeroErrorRow(tuningSweep)
    const shipGate = zeroErrorRow ?? minWrongRow(tuningSweep)
    const shipGateIsZeroError = zeroErrorRow !== null

    const holdoutAtShipGate = evaluateAtThreshold(holdoutResults, shipGate.high, shipGate.margin)
    const holdoutWrong = wrongCasesAtThreshold(holdoutResults, shipGate.high, shipGate.margin)
    const holdoutBreakdown = breakdownAtThreshold(holdoutResults, shipGate.high, shipGate.margin)
    const autoLinkedHoldout = [...holdoutBreakdown.autoCorrectCases, ...holdoutBreakdown.autoWrongCases]

    const frontier = shipGateIsZeroError
      ? [
          probeDirection("HIGH", tuningResults, tuningSweep, shipGate),
          probeDirection("MARGIN", tuningResults, tuningSweep, shipGate),
        ]
      : []

    folds.push({
      index: i,
      holdoutCanonicalCount: distinctCanonicalCount(holdoutResults),
      tuningSweep,
      shipGate,
      shipGateIsZeroError,
      holdoutAtShipGate,
      holdoutAutoLinkedDistinctCanonicals: distinctCanonicalCount(autoLinkedHoldout),
      holdoutWrongDistinctCanonicals: distinctCanonicalCount(holdoutBreakdown.autoWrongCases),
      frontier,
    })

    pooledAutoLinked += holdoutAtShipGate.autoLinked
    pooledCorrect += holdoutAtShipGate.correct
    pooledWrong += holdoutAtShipGate.wrong
    pooledCases += holdoutResults.length
    pooledWrongCases.push(...holdoutWrong)
    pooledAutoLinkedCases.push(...autoLinkedHoldout)
    pooledCorrectCases.push(...holdoutBreakdown.autoCorrectCases)
    for (const r of autoLinkedHoldout) pooledAutoLinkedCanonicals.add(r.expectedCanonicalId)
    for (const r of holdoutBreakdown.autoWrongCases) pooledWrongCanonicals.add(r.expectedCanonicalId)
  }

  const pooledCoveragePct = pooledCases > 0 ? (pooledAutoLinked / pooledCases) * 100 : 0
  const pooledPrecisionPct = pooledAutoLinked > 0 ? (pooledCorrect / pooledAutoLinked) * 100 : 0

  return {
    k: K,
    totalDistinctCanonicals: allCanonicals.size,
    folds,
    pooled: {
      high: NaN,
      margin: NaN,
      autoLinked: pooledAutoLinked,
      correct: pooledCorrect,
      wrong: pooledWrong,
      coveragePct: pooledCoveragePct,
      precisionPct: pooledPrecisionPct,
    },
    pooledAutoLinkedDistinctCanonicals: pooledAutoLinkedCanonicals.size,
    pooledWrongDistinctCanonicals: pooledWrongCanonicals.size,
    pooledWrongCases,
    pooledAutoLinkedCases,
    pooledCorrectCases,
  }
}
