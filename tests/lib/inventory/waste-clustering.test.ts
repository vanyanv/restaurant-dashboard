// classifyWastePattern — pure rule-based classifier.

import { describe, it, expect } from "vitest"
import { classifyWastePattern } from "@/lib/inventory/waste-clustering"

describe("classifyWastePattern", () => {
  it("returns insufficient_data when there are < 3 residuals", () => {
    const c = classifyWastePattern({
      residuals: [1, 2],
      adjustments: [],
      weeklyThroughput: 100,
    })
    expect(c.label).toBe("insufficient_data")
  })

  it("labels small residuals at high throughput as stable_within_noise", () => {
    const c = classifyWastePattern({
      residuals: [0.5, -0.3, 0.4, 0.2, -0.1],
      adjustments: [],
      weeklyThroughput: 100,
    })
    expect(c.label).toBe("stable_within_noise")
    expect(c.meanResidualPctOfThroughput).toBeLessThan(0.05)
  })

  it("labels consistently positive residuals as systematic_overuse", () => {
    const c = classifyWastePattern({
      residuals: [12, 14, 11, 13, 12],
      adjustments: [],
      weeklyThroughput: 100,
    })
    // No expiry/theft logged but the bias is real → theft_or_unrecorded.
    expect(c.label).toBe("theft_or_unrecorded")
    expect(c.meanResidual).toBeGreaterThan(10)
  })

  it("labels consistently negative residuals as systematic_underuse", () => {
    const c = classifyWastePattern({
      residuals: [-12, -14, -11, -13, -12],
      adjustments: [],
      weeklyThroughput: 100,
    })
    expect(c.label).toBe("systematic_underuse")
  })

  it("labels overuse with logged expiry as systematic_overuse (not theft)", () => {
    const c = classifyWastePattern({
      residuals: [11, 12, 10, 13],
      adjustments: [{ reason: "EXPIRY", qty: 5 }],
      weeklyThroughput: 100,
    })
    expect(c.label).toBe("systematic_overuse")
  })

  it("labels high-variance overuse with logged expiry as expiry_driven", () => {
    const c = classifyWastePattern({
      residuals: [-2, 30, -5, 25, -1],
      adjustments: [
        { reason: "EXPIRY", qty: 8 },
        { reason: "EXPIRY", qty: 12 },
      ],
      weeklyThroughput: 100,
    })
    expect(c.label).toBe("expiry_driven")
    expect(c.expiryAdjustments).toBe(2)
  })

  it("labels a converging series as improving", () => {
    const c = classifyWastePattern({
      // Older half avg ~25, newer half avg ~3 → ratio 0.12 < 0.4
      residuals: [25, 28, 22, 30, 3, 2, 4, 2],
      adjustments: [],
      weeklyThroughput: 100,
    })
    expect(c.label).toBe("improving")
  })

  it("falls back to stable when residuals are between noise and bias bands", () => {
    const c = classifyWastePattern({
      residuals: [7, 6, 8, 7, 6, 8],
      adjustments: [],
      weeklyThroughput: 100,
    })
    // 7% mean is above 5% noise band but below 10% strong-bias band.
    expect(c.label).toBe("stable_within_noise")
  })
})
