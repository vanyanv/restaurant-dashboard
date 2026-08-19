// The forecast has never shown its own track record. `MlForecastEvaluation`
// holds wape, baselineWape and intervalCoverage80 per store, and no file under
// src/ read the table. These tests pin the combination rules — above all that a
// coverage miss is reported as a miss rather than rounded away, since the whole
// point of the scorecard is that it isn't flattering.

import { describe, it, expect } from "vitest"
import {
  COVERAGE_TARGET,
  combineEvaluations,
  type EvaluationRow,
} from "@/app/dashboard/decisions/lib/scorecard"

const row = (over: Partial<EvaluationRow> = {}): EvaluationRow => ({
  wape: 0.064,
  baselineWape: 0.093,
  intervalCoverage80: 0.81,
  sampleSize: 30,
  ...over,
})

describe("combineEvaluations", () => {
  it("returns null when there is nothing to report", () => {
    expect(combineEvaluations([])).toBeNull()
  })

  it("passes a single store's row through", () => {
    const s = combineEvaluations([row()])!
    expect(s.wape).toBeCloseTo(0.064, 5)
    expect(s.intervalCoverage80).toBeCloseTo(0.81, 5)
    expect(s.sampleSize).toBe(30)
  })

  it("states how far the model beats the naive baseline", () => {
    // (0.093 - 0.064) / 0.093
    expect(combineEvaluations([row()])!.beatsBaselineBy).toBeCloseTo(0.3118, 3)
  })

  it("reports a negative margin when the model loses to the baseline", () => {
    const s = combineEvaluations([row({ wape: 0.12, baselineWape: 0.093 })])!
    expect(s.beatsBaselineBy).toBeLessThan(0)
  })

  it("weights across stores by sample size, not evenly", () => {
    const s = combineEvaluations([
      row({ wape: 0.05, sampleSize: 90 }),
      row({ wape: 0.20, sampleSize: 10 }),
    ])!
    // 90/100 * 0.05 + 10/100 * 0.20 = 0.065, not the flat mean of 0.125
    expect(s.wape).toBeCloseTo(0.065, 5)
  })

  it("ignores informational rows — the schema says sampleSize 0 means no metrics", () => {
    const s = combineEvaluations([
      row({ wape: 0.05, sampleSize: 30 }),
      row({ wape: 0.90, sampleSize: 0 }),
    ])!
    expect(s.wape).toBeCloseTo(0.05, 5)
    expect(s.sampleSize).toBe(30)
  })

  it("returns null when every row is informational", () => {
    expect(combineEvaluations([row({ sampleSize: 0 })])).toBeNull()
  })

  it("reports a coverage miss as a miss", () => {
    const s = combineEvaluations([row({ intervalCoverage80: 0.692 })])!
    expect(s.intervalCoverage80).toBeCloseTo(0.692, 5)
    expect(s.coverageMeetsTarget).toBe(false)
    expect(COVERAGE_TARGET).toBe(0.8)
  })

  it("allows a small tolerance so 79.6% doesn't read as failing", () => {
    expect(combineEvaluations([row({ intervalCoverage80: 0.796 })])!.coverageMeetsTarget).toBe(true)
    expect(combineEvaluations([row({ intervalCoverage80: 0.74 })])!.coverageMeetsTarget).toBe(false)
  })

  it("survives missing metrics without inventing them", () => {
    const s = combineEvaluations([
      row({ baselineWape: null, intervalCoverage80: null }),
    ])!
    expect(s.wape).toBeCloseTo(0.064, 5)
    expect(s.baselineWape).toBeNull()
    expect(s.beatsBaselineBy).toBeNull()
    expect(s.intervalCoverage80).toBeNull()
    expect(s.coverageMeetsTarget).toBeNull()
  })

  it("skips a null metric in the weighting rather than treating it as zero", () => {
    const s = combineEvaluations([
      row({ wape: null, sampleSize: 90 }),
      row({ wape: 0.10, sampleSize: 10 }),
    ])!
    expect(s.wape).toBeCloseTo(0.10, 5)
  })
})
