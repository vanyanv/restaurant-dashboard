// Pure Bayesian-calibration math for IngredientModelState. No Prisma here —
// these functions take a prior state + a recount observation and return the
// next state. Wiring into completeStockCount is a separate slice.

import { describe, it, expect } from "vitest"
import {
  applyRecountUpdate,
  recountStdDev,
  deriveConfidenceLevel,
  isResidualTight,
  initialModelState,
  CALIBRATION_ALPHA,
  TIGHT_RESIDUAL_FRAC,
  TIGHT_STD_FRAC,
  MIN_SAMPLES_TO_GRADUATE,
  MIN_TIGHT_WEEKS,
} from "@/lib/inventory/calibration"

describe("initialModelState", () => {
  it("starts with prior = 1.0 calibration and no samples", () => {
    const s = initialModelState()
    expect(s.calibrationFactor).toBe(1.0)
    expect(s.sampleSize).toBe(0)
    expect(s.recountDeltaMean).toBe(0)
    expect(s.recountDeltaM2).toBe(0)
    expect(s.consecutiveTightWeeks).toBe(0)
    expect(s.isGraduated).toBe(false)
  })
})

describe("applyRecountUpdate", () => {
  it("EWMA-pulls calibration toward observation = observed/theoretical", () => {
    const next = applyRecountUpdate(initialModelState(), {
      theoreticalDepletion: 10,
      observedDepletion: 12,
      residual: 0,
      weeklyThroughput: 10,
    })
    // observation = 1.2; α = 0.3 → factor = 1*(1−0.3) + 1.2*0.3 = 1.06
    expect(next.calibrationFactor).toBeCloseTo(0.7 + 0.3 * 1.2, 5)
    expect(next.sampleSize).toBe(1)
  })

  it("clamps degenerate observations (theoretical = 0) and leaves factor unchanged", () => {
    const next = applyRecountUpdate(initialModelState(), {
      theoreticalDepletion: 0,
      observedDepletion: 5,
      residual: 0,
      weeklyThroughput: 10,
    })
    expect(next.calibrationFactor).toBe(1.0)
    expect(next.sampleSize).toBe(1)
  })

  it("clamps wildly negative or huge observations to a safe band", () => {
    // observation = -3 (negative depletion impossible, e.g. mis-keyed count) — clamp
    const a = applyRecountUpdate(initialModelState(), {
      theoreticalDepletion: 1,
      observedDepletion: -3,
      residual: 0,
      weeklyThroughput: 10,
    })
    expect(a.calibrationFactor).toBeGreaterThanOrEqual(0.7) // can't pull below clamp
    // observation = 50 (e.g. partial-recipe coverage) — clamp
    const b = applyRecountUpdate(initialModelState(), {
      theoreticalDepletion: 1,
      observedDepletion: 50,
      residual: 0,
      weeklyThroughput: 10,
    })
    expect(b.calibrationFactor).toBeLessThanOrEqual(2.0)
  })

  it("Welford-updates running mean + M2 of residuals", () => {
    let s = initialModelState()
    const residuals = [1, -1, 2, -2, 0]
    for (const r of residuals) {
      s = applyRecountUpdate(s, {
        theoreticalDepletion: 10,
        observedDepletion: 10,
        residual: r,
        weeklyThroughput: 10,
      })
    }
    expect(s.sampleSize).toBe(5)
    expect(s.recountDeltaMean).toBeCloseTo(0, 5)
    // sample variance of [1,-1,2,-2,0] = 2.5 → SD ≈ 1.5811
    expect(recountStdDev(s)).toBeCloseTo(Math.sqrt(2.5), 4)
  })

  it("counts a 'tight' week when |residual|/throughput ≤ TIGHT_RESIDUAL_FRAC", () => {
    let s = initialModelState()
    s = applyRecountUpdate(s, {
      theoreticalDepletion: 10,
      observedDepletion: 10,
      residual: 0.4, // 4% of 10 → tight
      weeklyThroughput: 10,
    })
    expect(s.consecutiveTightWeeks).toBe(1)
    s = applyRecountUpdate(s, {
      theoreticalDepletion: 10,
      observedDepletion: 10,
      residual: 1.0, // 10% of 10 → loose, resets counter
      weeklyThroughput: 10,
    })
    expect(s.consecutiveTightWeeks).toBe(0)
  })

  it("graduates after MIN_SAMPLES_TO_GRADUATE samples + MIN_TIGHT_WEEKS consecutive tight weeks", () => {
    let s = initialModelState()
    for (let i = 0; i < MIN_SAMPLES_TO_GRADUATE - MIN_TIGHT_WEEKS; i++) {
      s = applyRecountUpdate(s, {
        theoreticalDepletion: 10,
        observedDepletion: 10,
        residual: 1.0, // loose, doesn't satisfy tight rule
        weeklyThroughput: 10,
      })
    }
    expect(s.isGraduated).toBe(false)
    for (let i = 0; i < MIN_TIGHT_WEEKS; i++) {
      s = applyRecountUpdate(s, {
        theoreticalDepletion: 10,
        observedDepletion: 10,
        residual: 0.2, // 2% of 10 → tight
        weeklyThroughput: 10,
      })
    }
    expect(s.sampleSize).toBe(MIN_SAMPLES_TO_GRADUATE)
    expect(s.consecutiveTightWeeks).toBe(MIN_TIGHT_WEEKS)
    expect(s.isGraduated).toBe(true)
    expect(s.graduatedAt).toBeInstanceOf(Date)
  })

  it("requires both tight mean AND tight std to graduate (high std blocks it)", () => {
    let s = initialModelState()
    // 4 alternating tight-but-noisy residuals at the cliff
    const noisyResiduals = [0.4, -0.4, 0.4, -0.4, 0.4, -0.4, 0.4, -0.4]
    for (const r of noisyResiduals) {
      s = applyRecountUpdate(s, {
        theoreticalDepletion: 10,
        observedDepletion: 10,
        residual: r,
        weeklyThroughput: 1, // throughput = 1 → std/throughput will exceed 10%
      })
    }
    expect(s.sampleSize).toBe(8)
    expect(s.isGraduated).toBe(false)
  })
})

describe("isResidualTight", () => {
  it("uses TIGHT_RESIDUAL_FRAC × throughput as the threshold", () => {
    expect(isResidualTight(0.4, 10)).toBe(true) // 4% < 5%
    expect(isResidualTight(0.6, 10)).toBe(false) // 6% > 5%
    expect(isResidualTight(0, 10)).toBe(true)
  })
  it("returns false when throughput is 0 or null (no signal)", () => {
    expect(isResidualTight(0, 0)).toBe(false)
    expect(isResidualTight(0, null)).toBe(false)
  })
})

describe("deriveConfidenceLevel", () => {
  it("LOW for sampleSize < 4 (not graduated)", () => {
    expect(deriveConfidenceLevel({ sampleSize: 0, isGraduated: false })).toBe("LOW")
    expect(deriveConfidenceLevel({ sampleSize: 3, isGraduated: false })).toBe("LOW")
  })
  it("MEDIUM for 4–7 samples not graduated", () => {
    expect(deriveConfidenceLevel({ sampleSize: 4, isGraduated: false })).toBe("MEDIUM")
    expect(deriveConfidenceLevel({ sampleSize: 7, isGraduated: false })).toBe("MEDIUM")
  })
  it("HIGH once graduated, until 16 samples", () => {
    expect(deriveConfidenceLevel({ sampleSize: 8, isGraduated: true })).toBe("HIGH")
    expect(deriveConfidenceLevel({ sampleSize: 15, isGraduated: true })).toBe("HIGH")
  })
  it("VERIFIED at sampleSize ≥ 16 graduated", () => {
    expect(deriveConfidenceLevel({ sampleSize: 16, isGraduated: true })).toBe("VERIFIED")
    expect(deriveConfidenceLevel({ sampleSize: 28, isGraduated: true })).toBe("VERIFIED")
  })
})

describe("constants", () => {
  it("matches the values described in the plan", () => {
    expect(CALIBRATION_ALPHA).toBe(0.3)
    expect(TIGHT_RESIDUAL_FRAC).toBe(0.05)
    expect(TIGHT_STD_FRAC).toBe(0.1)
    expect(MIN_SAMPLES_TO_GRADUATE).toBe(8)
    expect(MIN_TIGHT_WEEKS).toBe(4)
  })
})
