/**
 * Contract coverage for the LLM bake-off's own statistical machinery (task 6,
 * fix round 1, point 7). Written specifically to catch the stale-field bug
 * this round found and fixed: `analyzeLlmGroupedKFold` briefly computed
 * vector's fixed "correct" contribution by filtering on
 * `ArmResult.correctAtDefaultThresholds`, which reflects classification at
 * PRODUCTION DEFAULT thresholds (HIGH=0.9, MARGIN=0.05) — not at whatever
 * gate the caller actually used to decide a case was a fixed auto-link. That
 * silently dropped almost the entire vector contribution from "correct" and
 * shipped a report showing e.g. 10.7% precision instead of the true 99.5%.
 * `test-1` below reproduces exactly that shape (a case ambiguous at default
 * thresholds, therefore `correctAtDefaultThresholds: null`, that the caller
 * has nonetheless bucketed as a ship-gate-correct fixed auto-link) and would
 * fail immediately if that filtering ever came back.
 *
 * Imports the harness via relative paths, matching how the scripts
 * themselves import (`../../src/...`). No restructuring of the harness for
 * testability beyond what task 6's own code already exports.
 */

import { describe, it, expect } from "vitest"

import { analyzeLlmGroupedKFold } from "../../scripts/eval-ingredient-match/llm-kfold"
import { poolLevelWrongResolutions, countDuplicateDraftIds } from "../../scripts/eval-ingredient-match/llm-resolve"
import type { LlmResult } from "../../scripts/eval-ingredient-match/llm-resolve"
import type { ArmResult } from "../../scripts/eval-ingredient-match/arms"
import type { GoldCase } from "../../scripts/eval-ingredient-match/gold"
import type { AdjudicatorDraft } from "../../src/lib/ingredient-match-llm"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeGoldCase(id: string, expectedCanonicalId: string): GoldCase {
  return {
    id,
    vendorName: "Test Vendor",
    sku: null,
    productName: id,
    unit: null,
    expectedCanonicalId,
    expectedCanonicalName: expectedCanonicalId,
    source: "sku",
    occurrences: 1,
  }
}

/** A vector-fixed-auto ArmResult that is AMBIGUOUS at production default
 * thresholds (`correctAtDefaultThresholds: null`) but that the caller has
 * bucketed as ship-gate-correct — the exact shape `splitPool` produces for a
 * case whose top score clears a looser ship gate than the 0.9/0.05 default. */
function makeShipGateCorrectButDefaultAmbiguous(caseId: string, expectedCanonicalId: string): ArmResult {
  return {
    caseId,
    expectedCanonicalId,
    decision: "ambiguous",
    chosenCanonicalId: null,
    correctAtDefaultThresholds: null,
    topScore: 0.8,
    margin: 0.01,
    candidates: [{ canonicalIngredientId: expectedCanonicalId, name: expectedCanonicalId, score: 0.8 }],
  }
}

function makeLlmResult(overrides: Partial<LlmResult>): LlmResult {
  return {
    caseId: "case-1",
    expectedCanonicalId: "canon-1",
    expectedCanonicalName: "canon-1",
    vectorTopScore: 0.5,
    matchName: "canon-1",
    confidence: 0.9,
    reasoning: "",
    resolvedCanonicalId: "canon-1",
    resolvedCandidateName: "canon-1",
    hallucinated: false,
    correct: true,
    missingDraft: false,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// analyzeLlmGroupedKFold
// ---------------------------------------------------------------------------

describe("analyzeLlmGroupedKFold", () => {
  it("counts a fixed vector auto-link as correct by array membership, not by the stale correctAtDefaultThresholds field", () => {
    const canonicalId = "canon-regression"
    const goldCases = [makeGoldCase("case-regression", canonicalId)]
    const vectorFixedCorrect = [makeShipGateCorrectButDefaultAmbiguous("case-regression", canonicalId)]
    const vectorFixedWrong: ArmResult[] = []
    const poolResults: LlmResult[] = []

    // Sanity: the fixture's own default-threshold field is null, exactly
    // like a real ambiguous-at-default, correct-at-ship-gate case. If this
    // assertion ever fails, the fixture stopped representing the bug.
    expect(vectorFixedCorrect[0].correctAtDefaultThresholds).toBeNull()

    const a = analyzeLlmGroupedKFold(goldCases, vectorFixedCorrect, vectorFixedWrong, poolResults)

    expect(a.pooledCombined.autoLinked).toBe(1)
    expect(a.pooledCombined.correct).toBe(1)
    expect(a.pooledCombined.wrong).toBe(0)
    expect(a.pooledCombined.precisionPct).toBe(100)
  })

  it("counts a fixed vector auto-link as wrong by array membership, symmetric with the correct case above", () => {
    const canonicalId = "canon-regression-wrong"
    const goldCases = [makeGoldCase("case-regression-wrong", canonicalId)]
    const wrongCase: ArmResult = {
      ...makeShipGateCorrectButDefaultAmbiguous("case-regression-wrong", canonicalId),
      chosenCanonicalId: "some-other-canonical",
    }

    const a = analyzeLlmGroupedKFold(goldCases, [], [wrongCase], [])

    expect(a.pooledCombined.autoLinked).toBe(1)
    expect(a.pooledCombined.correct).toBe(0)
    expect(a.pooledCombined.wrong).toBe(1)
  })

  it("pooledLlmOnly isolates the LLM's own contribution from the fixed vector contribution", () => {
    const canonicalId = "canon-mixed"
    const goldCases = [makeGoldCase("vector-case", canonicalId), makeGoldCase("llm-case", canonicalId)]
    const vectorFixedCorrect = [makeShipGateCorrectButDefaultAmbiguous("vector-case", canonicalId)]
    const llmResult = makeLlmResult({ caseId: "llm-case", expectedCanonicalId: canonicalId, confidence: 1, correct: true })

    const a = analyzeLlmGroupedKFold(goldCases, vectorFixedCorrect, [], [llmResult])

    // Both the vector case and the LLM case share one canonical, so they
    // land in the same fold and are scored together in that fold's holdout.
    expect(a.pooledCombined.autoLinked).toBe(2)
    expect(a.pooledCombined.correct).toBe(2)
    expect(a.pooledLlmOnly.accepted).toBe(1)
    expect(a.pooledLlmOnly.correct).toBe(1)
    // The combined total must never be attributed entirely to the LLM.
    expect(a.pooledLlmOnly.accepted).toBeLessThan(a.pooledCombined.autoLinked)
  })
})

// ---------------------------------------------------------------------------
// poolLevelWrongResolutions / countDuplicateDraftIds
// ---------------------------------------------------------------------------

describe("poolLevelWrongResolutions", () => {
  it("includes every wrong resolution regardless of confidence", () => {
    const results: LlmResult[] = [
      makeLlmResult({ caseId: "a", correct: true, confidence: 0.99 }),
      makeLlmResult({ caseId: "b", correct: false, confidence: 0.5 }),
      makeLlmResult({ caseId: "c", correct: false, confidence: 0.98 }),
    ]
    const wrong = poolLevelWrongResolutions(results)
    expect(wrong.map((r) => r.caseId).sort()).toEqual(["b", "c"])
  })

  it("excludes abstentions (resolvedCanonicalId null) even when correct is null", () => {
    const results: LlmResult[] = [makeLlmResult({ caseId: "abstained", resolvedCanonicalId: null, correct: null })]
    expect(poolLevelWrongResolutions(results)).toEqual([])
  })
})

describe("countDuplicateDraftIds", () => {
  it("counts drafts beyond the first per caseId", () => {
    const drafts: AdjudicatorDraft[] = [
      { caseId: "x", matchName: "a", confidence: 0.9, reasoning: "" },
      { caseId: "y", matchName: "a", confidence: 0.9, reasoning: "" },
      { caseId: "x", matchName: "b", confidence: 0.5, reasoning: "" },
    ]
    expect(countDuplicateDraftIds(drafts)).toBe(1)
  })

  it("returns 0 for an empty or fully-unique draft list", () => {
    expect(countDuplicateDraftIds([])).toBe(0)
    expect(
      countDuplicateDraftIds([
        { caseId: "x", matchName: null, confidence: 0.9, reasoning: "" },
        { caseId: "y", matchName: null, confidence: 0.9, reasoning: "" },
      ]),
    ).toBe(0)
  })
})
