/**
 * Coverage for the statistical machinery behind the ingredient auto-match
 * bake-off's go/no-go numbers (round-4, point 6). Before this file,
 * `analyzeGroupedKFold`, `weightedCount`, `newCasesAtFloor` and
 * `wilsonUpper95` had no tests at all — the figures a ship decision rests on
 * came from unexercised code.
 *
 * These import the harness via relative paths, matching how the scripts
 * themselves import (`../../src/...`). Nothing in the harness was restructured
 * to make it testable; the only change was exporting `foldOf`/`K` so the fold
 * partition can be asserted against the same assignment the analysis uses.
 */

import { describe, it, expect } from "vitest"

import { wilsonUpper95 } from "../../scripts/eval-ingredient-match/sweep-analysis"
import {
  analyzeGroupedKFold,
  buildFoldMap,
  foldOf,
  medianOf,
  partitionFolds,
  K,
} from "../../scripts/eval-ingredient-match/holdout-analysis"
import { newCasesAtFloor } from "../../scripts/eval-ingredient-match/threshold-eval"
import { weightedCount, occurrencesOf } from "../../scripts/eval-ingredient-match/weighting"
import type { ArmResult } from "../../scripts/eval-ingredient-match/arms"
import type { GoldCase } from "../../scripts/eval-ingredient-match/gold"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeResult(
  caseId: string,
  expectedCanonicalId: string,
  topScore: number,
  runnerUpScore: number,
  topIsCorrect = true,
): ArmResult {
  const topId = topIsCorrect ? expectedCanonicalId : `${expectedCanonicalId}-WRONG`
  const runnerUpId = topIsCorrect ? `${expectedCanonicalId}-other` : expectedCanonicalId
  const candidates = [
    { canonicalIngredientId: topId, name: topId, score: topScore },
    { canonicalIngredientId: runnerUpId, name: runnerUpId, score: runnerUpScore },
  ]
  return {
    caseId,
    expectedCanonicalId,
    decision: "auto",
    chosenCanonicalId: topId,
    correct: topIsCorrect,
    topScore,
    margin: topScore - runnerUpScore,
    candidates,
  }
}

function makeGoldCase(id: string, expectedCanonicalId: string, occurrences: number): GoldCase {
  return {
    id,
    vendorName: "Vendor",
    sku: null,
    productName: id,
    unit: null,
    expectedCanonicalId,
    expectedCanonicalName: expectedCanonicalId,
    source: "sku",
    occurrences,
  }
}

/** 20 canonicals x 3 spelling variants = 60 cases, all comfortably auto-linkable. */
function buildFixture(): { cases: GoldCase[]; results: ArmResult[] } {
  const cases: GoldCase[] = []
  const results: ArmResult[] = []
  for (let c = 0; c < 20; c++) {
    const canonicalId = `canon-${c}`
    for (let v = 0; v < 3; v++) {
      const caseId = `case-${c}-${v}`
      cases.push(makeGoldCase(caseId, canonicalId, v + 1))
      results.push(makeResult(caseId, canonicalId, 0.95, 0.4))
    }
  }
  return { cases, results }
}

// ---------------------------------------------------------------------------
// wilsonUpper95
// ---------------------------------------------------------------------------

describe("wilsonUpper95", () => {
  it("matches the textbook value for 0 successes out of 10", () => {
    // Standard Wilson 95% upper bound for 0/10 is 0.27753 (z = 1.959964).
    expect(wilsonUpper95(0, 10)).toBeCloseTo(0.277531, 5);
  })

  it("is well-defined at wrong=0 and never returns 0", () => {
    // The whole point of reporting a bound: "0 wrong out of n" is not proof of
    // a zero error rate. A bound of 0 here would silently assert the opposite.
    for (const n of [1, 10, 57, 147, 150, 1000]) {
      const upper = wilsonUpper95(0, n)
      expect(upper).toBeGreaterThan(0)
      expect(upper).toBeLessThan(1)
    }
  })

  it("reproduces the two bounds quoted in the committed run report", () => {
    // vector-only pooled: 1 wrong / 150 auto-linked cases -> 3.7%
    expect(wilsonUpper95(1, 150) * 100).toBeCloseTo(3.7, 1)
    // ...and on the honest distinct-canonical denominator: 1 / 57 -> 9.3%
    expect(wilsonUpper95(1, 57) * 100).toBeCloseTo(9.3, 1)
  })

  it("shrinks monotonically as the sample grows at a fixed observed rate", () => {
    const bounds = [10, 50, 100, 500, 1000].map((n) => wilsonUpper95(0, n))
    for (let i = 1; i < bounds.length; i++) {
      expect(bounds[i]).toBeLessThan(bounds[i - 1])
    }
  })

  it("returns 1 for a non-positive denominator rather than dividing by zero", () => {
    expect(wilsonUpper95(0, 0)).toBe(1)
    expect(wilsonUpper95(0, -5)).toBe(1)
  })

  it("is capped at 1 and bounded below by the observed rate", () => {
    expect(wilsonUpper95(5, 5)).toBe(1)
    expect(wilsonUpper95(3, 10)).toBeGreaterThan(0.3)
  })
})

// ---------------------------------------------------------------------------
// Grouped k-fold partitioning
// ---------------------------------------------------------------------------

describe("grouped k-fold fold assignment", () => {
  it("assigns every canonical to exactly one fold in range", () => {
    for (let c = 0; c < 200; c++) {
      const fold = foldOf(`canon-${c}`)
      expect(Number.isInteger(fold)).toBe(true)
      expect(fold).toBeGreaterThanOrEqual(0)
      expect(fold).toBeLessThan(K)
    }
  })

  it("is deterministic across calls", () => {
    for (let c = 0; c < 50; c++) {
      expect(foldOf(`canon-${c}`)).toBe(foldOf(`canon-${c}`))
    }
  })

})

describe("partitionFolds (the real split, not a re-derivation)", () => {
  // These call the implementation and assert on what it returned. An earlier
  // version of this suite re-filtered the canonical list inside the test body
  // and asserted the two halves were disjoint — which tests
  // Array.prototype.filter, not the harness. Proven by mutation: replacing
  // `tuningResults` with `results.slice()` (total leakage — every held-out
  // canonical also in tuning) left that version fully green.

  it("never puts a canonical in both the tuning and held-out side of a fold", () => {
    const { cases, results } = buildFixture()
    const partitions = partitionFolds(results, buildFoldMap(cases))

    expect(partitions.length).toBeGreaterThan(0)
    for (const p of partitions) {
      const tuningCanonicals = new Set(p.tuningResults.map((r) => r.expectedCanonicalId))
      const holdoutCanonicals = new Set(p.holdoutResults.map((r) => r.expectedCanonicalId))

      expect(holdoutCanonicals.size).toBeGreaterThan(0)
      for (const id of holdoutCanonicals) {
        expect(tuningCanonicals.has(id)).toBe(false)
      }
      for (const id of tuningCanonicals) {
        expect(holdoutCanonicals.has(id)).toBe(false)
      }
    }
  })

  it("splits every case into exactly one side of each fold, losing none", () => {
    const { cases, results } = buildFixture()
    const partitions = partitionFolds(results, buildFoldMap(cases))

    for (const p of partitions) {
      expect(p.tuningResults.length + p.holdoutResults.length).toBe(results.length)
      const ids = new Set([...p.tuningResults, ...p.holdoutResults].map((r) => r.caseId))
      expect(ids.size).toBe(results.length)
    }
  })

  it("holds every canonical out in exactly one fold across the whole run", () => {
    const { cases, results } = buildFixture()
    const partitions = partitionFolds(results, buildFoldMap(cases))

    const heldOutIn = new Map<string, number>()
    for (const p of partitions) {
      for (const id of new Set(p.holdoutResults.map((r) => r.expectedCanonicalId))) {
        heldOutIn.set(id, (heldOutIn.get(id) ?? 0) + 1)
      }
    }
    const allCanonicals = new Set(cases.map((c) => c.expectedCanonicalId))
    expect(heldOutIn.size).toBe(allCanonicals.size)
    for (const id of allCanonicals) expect(heldOutIn.get(id)).toBe(1)
  })

  it("selects each fold's gate from tuning data only", () => {
    const { cases, results } = buildFixture()
    const partitions = partitionFolds(results, buildFoldMap(cases))

    for (const p of partitions) {
      // The selected row must be reproducible from the tuning half alone.
      const row = p.tuningSweep.find(
        (r) => r.high === p.ownSelection.high && r.margin === p.ownSelection.margin,
      )
      expect(row).toBeDefined()
      expect(row!.autoLinked).toBe(p.ownSelection.autoLinked)
      expect(row!.wrong).toBe(p.ownSelection.wrong)
      // ...and the sweep it came from must be the tuning half's, not everything.
      expect(p.tuningResults.length).toBeLessThan(results.length)
    }
  })
})

describe("analyzeGroupedKFold", () => {
  it("holds out every case exactly once across all folds", () => {
    const { cases, results } = buildFixture()
    const a = analyzeGroupedKFold(cases, results)

    expect(a.pooledAllCases).toHaveLength(results.length)
    const seen = new Set(a.pooledAllCases.map((r) => r.caseId))
    expect(seen.size).toBe(results.length)
    for (const r of results) expect(seen.has(r.caseId)).toBe(true)
    expect(a.totalCases).toBe(results.length)
  })

  it("partitions the canonicals — fold hold-out counts sum to the total", () => {
    const { cases, results } = buildFixture()
    const a = analyzeGroupedKFold(cases, results)

    const summed = a.folds.reduce((s, f) => s + f.holdoutCanonicalCount, 0)
    expect(a.totalDistinctCanonicals).toBe(20)
    expect(summed).toBe(a.totalDistinctCanonicals)
  })

  it("never counts a case as both auto-linked and absent from the pooled set", () => {
    const { cases, results } = buildFixture()
    const a = analyzeGroupedKFold(cases, results)

    const all = new Set(a.pooledAllCases.map((r) => r.caseId))
    for (const r of a.pooledAutoLinkedCases) expect(all.has(r.caseId)).toBe(true)
    for (const r of a.pooledCorrectCases) expect(all.has(r.caseId)).toBe(true)
    expect(a.pooled.autoLinked).toBe(a.pooledAutoLinkedCases.length)
    expect(a.pooled.correct).toBe(a.pooledCorrectCases.length)
    expect(a.pooled.wrong).toBe(a.pooled.autoLinked - a.pooled.correct)
  })

  it("applies one shared gate to every fold under the median rule", () => {
    const { cases, results } = buildFixture()
    const a = analyzeGroupedKFold(cases, results, "median")

    expect(a.rule).toBe("median")
    expect(a.sharedGate).not.toBeNull()
    for (const f of a.folds) {
      expect(f.shipGate.high).toBe(a.sharedGate!.high)
      expect(f.shipGate.margin).toBe(a.sharedGate!.margin)
    }
  })

  it("leaves each fold on its own gate under the permissive rule", () => {
    const { cases, results } = buildFixture()
    const a = analyzeGroupedKFold(cases, results, "permissive")

    expect(a.sharedGate).toBeNull()
    for (const f of a.folds) {
      expect(f.shipGate.high).toBe(f.ownSelection.high)
      expect(f.shipGate.margin).toBe(f.ownSelection.margin)
    }
  })

  it("scores a planted wrong answer as wrong, not as an abstention", () => {
    const { cases, results } = buildFixture()
    // Give one case a wrong top candidate with a wide margin, so no threshold
    // in the swept grid can abstain it away.
    results[0] = makeResult(results[0].caseId, results[0].expectedCanonicalId, 0.99, 0.3, false)
    const a = analyzeGroupedKFold(cases, results)
    expect(a.pooled.wrong + a.folds.reduce((s, f) => s + f.holdoutAtShipGate.wrong, 0)).toBeGreaterThan(0)
  })
})

describe("medianOf", () => {
  it("returns the middle value of an odd-length list regardless of input order", () => {
    expect(medianOf([0.1, 0.08, 0.1, 0.1, 0.1])).toBeCloseTo(0.1, 10)
    expect(medianOf([0.1, 0.1, 0.1, 0.1, 0.08])).toBeCloseTo(0.1, 10)
    expect(medianOf([3, 1, 2])).toBe(2)
  })

  it("takes the lower middle value for an even-length list, staying on the grid", () => {
    expect(medianOf([1, 2, 3, 4])).toBe(2)
  })

  it("is not fooled by a single outlier", () => {
    // The exact case this rule exists for: four folds pick 0.10, one picks 0.08.
    expect(medianOf([0.08, 0.1, 0.1, 0.1, 0.1])).toBeCloseTo(0.1, 10)
  })

  it("returns NaN for an empty list rather than a misleading zero", () => {
    expect(Number.isNaN(medianOf([]))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Occurrence weighting
// ---------------------------------------------------------------------------

describe("weightedCount / occurrencesOf", () => {
  const index = new Map<string, GoldCase>([
    ["a", makeGoldCase("a", "canon-1", 5)],
    ["b", makeGoldCase("b", "canon-1", 3)],
    ["c", makeGoldCase("c", "canon-2", 1)],
  ])

  it("sums occurrences rather than counting rows", () => {
    const results = [
      makeResult("a", "canon-1", 0.9, 0.4),
      makeResult("b", "canon-1", 0.9, 0.4),
      makeResult("c", "canon-2", 0.9, 0.4),
    ]
    expect(results).toHaveLength(3)
    expect(weightedCount(results, index)).toBe(9)
  })

  it("falls back to 1 for a case missing from the index, not 0", () => {
    // A silent 0 would make the case invisible to every weighted total —
    // strictly worse than counting it once.
    expect(occurrencesOf(index, "not-in-index")).toBe(1)
    const results = [makeResult("a", "canon-1", 0.9, 0.4), makeResult("ghost", "canon-9", 0.9, 0.4)]
    expect(weightedCount(results, index)).toBe(6)
  })

  it("treats an explicit occurrences of 0 as 0, not as the fallback", () => {
    const zeroIndex = new Map<string, GoldCase>([["z", makeGoldCase("z", "canon-1", 0)]])
    expect(occurrencesOf(zeroIndex, "z")).toBe(0)
  })

  it("returns 0 for an empty result list", () => {
    expect(weightedCount([], index)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// newCasesAtFloor
// ---------------------------------------------------------------------------

describe("newCasesAtFloor", () => {
  const results = [
    makeResult("a", "canon-1", 0.4, 0.1),
    makeResult("b", "canon-1", 0.6, 0.1),
    makeResult("c", "canon-2", 0.72, 0.1),
    makeResult("d", "canon-2", 0.9, 0.1),
  ]

  it("selects strictly-below-floor cases (a score exactly at FLOOR is not new)", () => {
    expect(newCasesAtFloor(results, 0.72).map((r) => r.caseId)).toEqual(["a", "b"])
  })

  it("is monotonically non-decreasing in floor", () => {
    let previous = 0
    for (let f = 0.3; f <= 1.0; f += 0.02) {
      const count = newCasesAtFloor(results, f).length
      expect(count).toBeGreaterThanOrEqual(previous)
      previous = count
    }
  })

  it("empties the bucket once floor drops below the lowest top score", () => {
    // This is the mechanism behind "zero duplicate-creates at FLOOR <= 0.44":
    // the bucket is empty because nothing can fill it, not because matching improved.
    expect(newCasesAtFloor(results, 0.4)).toHaveLength(0)
    expect(newCasesAtFloor(results, 0.39)).toHaveLength(0)
  })

  it("captures every case once floor exceeds the highest top score", () => {
    expect(newCasesAtFloor(results, 0.95)).toHaveLength(results.length)
  })
})
