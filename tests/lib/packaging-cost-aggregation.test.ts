import { describe, expect, it } from "vitest"
import {
  summarizeAvoidedDineInCost,
  type AvoidedCostSignatureRow,
} from "@/lib/packaging-cost-aggregation"
import type { ContainerGroup } from "@/lib/container-packaging"

const UNIT_COSTS: Record<ContainerGroup, number | null> = {
  medium_6x6: 0.084,
  large_9x6: 0.153,
  one_compartment: 0.162,
}

function sliderRow(occurrences: number): AvoidedCostSignatureRow {
  // 3x 1-Slider-Combo packs as 3 medium_6x6 → 3 × 0.084 = 0.252 per order.
  return {
    fulfillmentMode: "FULFILLMENT_MODE_DINE_IN",
    items: [
      {
        name: "1 Slider Combo",
        quantity: 3,
        subItems: [{ name: "Eddy Way", quantity: 1, subHeader: null }],
      },
    ],
    occurrences,
  }
}

describe("summarizeAvoidedDineInCost", () => {
  it("returns 0 for an empty input", () => {
    expect(summarizeAvoidedDineInCost([], UNIT_COSTS)).toBe(0)
  })

  it("computes single-occurrence cost identical to the per-order pack cost", () => {
    const total = summarizeAvoidedDineInCost([sliderRow(1)], UNIT_COSTS)
    expect(total).toBeCloseTo(0.252, 6)
  })

  it("multiplies pack cost by occurrences (the whole point of grouping)", () => {
    const total = summarizeAvoidedDineInCost([sliderRow(5)], UNIT_COSTS)
    expect(total).toBeCloseTo(0.252 * 5, 6)
  })

  it("sums across distinct signatures", () => {
    const total = summarizeAvoidedDineInCost(
      [sliderRow(2), sliderRow(3)],
      UNIT_COSTS
    )
    expect(total).toBeCloseTo(0.252 * 5, 6)
  })

  it("treats every null unit cost as 0 in the price rollup (no NaN, no null leak)", () => {
    const allNull: Record<ContainerGroup, number | null> = {
      medium_6x6: null,
      large_9x6: null,
      one_compartment: null,
    }
    const total = summarizeAvoidedDineInCost([sliderRow(4)], allNull)
    expect(total).toBe(0)
  })

  it("handles signature rows with empty items as 0 cost", () => {
    const row: AvoidedCostSignatureRow = {
      fulfillmentMode: "FULFILLMENT_MODE_DINE_IN",
      items: [],
      occurrences: 7,
    }
    expect(summarizeAvoidedDineInCost([row], UNIT_COSTS)).toBe(0)
  })
})
