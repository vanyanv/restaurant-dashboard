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

/** Exported so the fold-partition properties (disjointness, exhaustiveness)
 * can be asserted directly in tests against the same assignment the analysis
 * uses, rather than re-derived from a copy that could drift. */
export const K = 5
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

export function foldOf(canonicalId: string): number {
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

/**
 * How each fold's ship gate is chosen (round-4, point 2). The original
 * harness only ever used `permissive`, and that choice was doing real work in
 * the headline: `bestZeroErrorRow` maximises coverage subject to zero error,
 * i.e. it deliberately lands on the *loosest* threshold that still has no
 * errors on tuning — sitting exactly on the empirical error boundary with no
 * buffer. On this data fold 3 selected MARGIN=0.08 where the other four all
 * selected 0.10, and the single pooled `vector-only` error has margin 0.0971 —
 * so it is admitted by fold 3's gate and by no other fold's. Reporting only
 * that rule reports one arbitrary tie-break as if it were the result.
 *
 * `median` takes the per-fold selections from `permissive` and applies the
 * cross-fold median (HIGH, MARGIN) to every fold instead, so one fold's
 * idiosyncratically loose pick cannot set the operating point on its own.
 *
 * Why the median and not "the tightest zero-error row" (the other option
 * considered): tightest is degenerate here. Coverage falls monotonically as
 * HIGH rises, so rows near HIGH=0.99 auto-link (almost) nothing and are
 * therefore zero-error trivially — "tightest zero-error" selects an empty
 * gate that abstains on everything and measures nothing.
 *
 * The honest caveat, stated in the report too: the median is computed across
 * all five folds' tuning selections, and every fold's held-out canonicals sit
 * in the other four folds' tuning portions. So `median` is NOT a clean
 * leakage-free cross-validated estimate the way `permissive` is — it is a
 * *stability* diagnostic answering "does the pooled error survive when no
 * single fold gets to pick the gate alone?" Both are reported side by side
 * for that reason, and neither is presented as the single true number.
 */
export type GateRule = "permissive" | "median"

export const GATE_RULES: readonly GateRule[] = ["permissive", "median"] as const

export const GATE_RULE_LABELS: Record<GateRule, string> = {
  permissive: "permissive (highest-coverage zero-error row, per fold)",
  median: "conservative (cross-fold median HIGH/MARGIN, shared by all folds)",
}

export type Fold = {
  index: number
  holdoutCanonicalCount: number
  tuningSweep: ThresholdRow[]
  /** The row this fold's own tuning half selected under `permissive`. Kept
   * even under the median rule so the report can show what each fold *would*
   * have picked alone, which is the evidence that fold 3 is the outlier. */
  ownSelection: ThresholdRow
  /** The gate actually applied to this fold's held-out canonicals. Equals
   * `ownSelection` under `permissive`; the shared median row under `median`. */
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
  rule: GateRule
  /** Populated only for `median` — the shared gate every fold was scored at. */
  sharedGate: { high: number; margin: number } | null
  totalDistinctCanonicals: number
  totalCases: number
  folds: Fold[]
  pooled: ThresholdRow
  pooledAutoLinkedDistinctCanonicals: number
  pooledWrongDistinctCanonicals: number
  pooledWrongCases: WrongCaseAtThreshold[]
  /** Case lists (not just counts) across all folds' holdout evaluations, for
   * occurrence-weighted coverage/precision (fix-round-3, point 2). */
  pooledAutoLinkedCases: ArmResult[]
  pooledCorrectCases: ArmResult[]
  /** Every held-out case across all folds — the correct denominator for
   * occurrence-weighted pooled coverage. (Each case is held out exactly once,
   * so this is a partition of `results`, not a multiset.) */
  pooledAllCases: ArmResult[]
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

type Partition = {
  index: number
  tuningResults: ArmResult[]
  holdoutResults: ArmResult[]
  tuningSweep: ThresholdRow[]
  ownSelection: ThresholdRow
  ownSelectionIsZeroError: boolean
}

/** Split into folds and run each fold's own tuning-only selection. This is
 * the `permissive` rule; `median` is a second pass over these selections. */
function partitionFolds(results: ArmResult[], foldByCanonical: Map<string, number>): Partition[] {
  const partitions: Partition[] = []
  for (let i = 0; i < K; i++) {
    const tuningResults = results.filter((r) => foldByCanonical.get(r.expectedCanonicalId) !== i)
    const holdoutResults = results.filter((r) => foldByCanonical.get(r.expectedCanonicalId) === i)
    if (holdoutResults.length === 0) continue
    const tuningSweep = sweepThresholds(tuningResults)
    const zeroErrorRow = bestZeroErrorRow(tuningSweep)
    partitions.push({
      index: i,
      tuningResults,
      holdoutResults,
      tuningSweep,
      ownSelection: zeroErrorRow ?? minWrongRow(tuningSweep),
      ownSelectionIsZeroError: zeroErrorRow !== null,
    })
  }
  return partitions
}

/** Median of an odd/even-length numeric list. Even length takes the lower of
 * the two middle values — the more conservative choice is context-dependent,
 * so this picks deterministically rather than averaging into a value that is
 * not on the swept grid and therefore has no row to look up. */
export function medianOf(values: number[]): number {
  if (values.length === 0) return NaN
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor((sorted.length - 1) / 2)]
}

export function analyzeGroupedKFold(
  cases: GoldCase[],
  results: ArmResult[],
  rule: GateRule = "permissive",
): GroupedKFoldAnalysis {
  const allCanonicals = new Set(cases.map((c) => c.expectedCanonicalId))
  const foldByCanonical = new Map<string, number>()
  for (const id of allCanonicals) foldByCanonical.set(id, foldOf(id))

  const partitions = partitionFolds(results, foldByCanonical)

  // Under `median`, every fold is scored at one shared gate derived from the
  // five per-fold selections, instead of at its own.
  const sharedGate =
    rule === "median" && partitions.length > 0
      ? {
          high: round2(medianOf(partitions.map((p) => p.ownSelection.high))),
          margin: round2(medianOf(partitions.map((p) => p.ownSelection.margin))),
        }
      : null

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
  const pooledAllCases: ArmResult[] = []

  for (const p of partitions) {
    const { index: i, tuningResults, holdoutResults, tuningSweep, ownSelection } = p

    // Under `median` the applied gate is the shared row, looked up in this
    // fold's own tuning sweep so `shipGateIsZeroError` still reports whether
    // that gate was error-free on the data it may legitimately be judged on.
    const shipGate =
      sharedGate === null
        ? ownSelection
        : (tuningSweep.find((r) => r.high === sharedGate.high && r.margin === sharedGate.margin) ??
          evaluateAtThreshold(tuningResults, sharedGate.high, sharedGate.margin))
    const shipGateIsZeroError = sharedGate === null ? p.ownSelectionIsZeroError : shipGate.wrong === 0

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
      ownSelection,
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
    pooledAllCases.push(...holdoutResults)
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
    rule,
    sharedGate,
    totalDistinctCanonicals: allCanonicals.size,
    totalCases: pooledCases,
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
    pooledAllCases,
  }
}
