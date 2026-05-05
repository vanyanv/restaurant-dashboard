// computeVariance characterizes the per-ingredient variance + status logic
// from getProductUsageData. The thresholds (10% bands) and the
// over/under-ordered split (waste vs shortage cost) must match the original
// implementation exactly so the dashboard numbers don't shift.

import { describe, it, expect } from "vitest"
import { computeVariance } from "@/app/actions/_shared/variance"

describe("computeVariance", () => {
  it("classifies as no_recipe when theoretical usage is 0", () => {
    const result = computeVariance({ purchasedQty: 50, theoretical: 0, avgUnitCost: 2 })
    expect(result.status).toBe("no_recipe")
    expect(result.varianceQuantity).toBe(50)
    // variancePct is 0 when theoretical is 0 (matches original)
    expect(result.variancePct).toBe(0)
    // No theoretical → no waste/shortage classification, but cost still computed from variance sign
    expect(result.wasteEstimatedCost).toBe(100)
    expect(result.shortageEstimatedCost).toBe(0)
  })

  it("classifies as over_ordered when variance > +10%", () => {
    const result = computeVariance({ purchasedQty: 120, theoretical: 100, avgUnitCost: 3 })
    expect(result.status).toBe("over_ordered")
    expect(result.varianceQuantity).toBe(20)
    expect(result.variancePct).toBe(20)
    expect(result.wasteEstimatedCost).toBe(60)
    expect(result.shortageEstimatedCost).toBe(0)
  })

  it("classifies as under_ordered when variance < -10%", () => {
    const result = computeVariance({ purchasedQty: 80, theoretical: 100, avgUnitCost: 3 })
    expect(result.status).toBe("under_ordered")
    expect(result.varianceQuantity).toBe(-20)
    expect(result.variancePct).toBe(-20)
    expect(result.wasteEstimatedCost).toBe(0)
    expect(result.shortageEstimatedCost).toBe(60)
  })

  it("classifies as balanced when variance is within +/- 10%", () => {
    const result = computeVariance({ purchasedQty: 105, theoretical: 100, avgUnitCost: 5 })
    expect(result.status).toBe("balanced")
    expect(result.varianceQuantity).toBe(5)
    expect(result.variancePct).toBe(5)
    // Still tracked at the cost level
    expect(result.wasteEstimatedCost).toBe(25)
    expect(result.shortageEstimatedCost).toBe(0)
  })

  it("uses strict greater-than at the 10% boundary (matches original > / < behavior)", () => {
    // exactly 10% over → balanced (original code uses `> 10`, not `>= 10`)
    const exact10 = computeVariance({ purchasedQty: 110, theoretical: 100, avgUnitCost: 1 })
    expect(exact10.status).toBe("balanced")

    // 10.0001% over → over_ordered
    const just_over = computeVariance({ purchasedQty: 110.001, theoretical: 100, avgUnitCost: 1 })
    expect(just_over.status).toBe("over_ordered")
  })

  it("returns 0 for both costs when avgUnitCost is 0", () => {
    const result = computeVariance({ purchasedQty: 120, theoretical: 100, avgUnitCost: 0 })
    expect(result.wasteEstimatedCost).toBe(0)
    expect(result.shortageEstimatedCost).toBe(0)
  })
})
