import { describe, expect, it } from "vitest"
import {
  deriveCostFromLineItem,
  getLineItemBaseQty,
  type LineItemForCost,
} from "@/lib/invoice-line-shape"

function line(overrides: Partial<LineItemForCost> = {}): LineItemForCost {
  return {
    quantity: 1,
    unit: "CS",
    packSize: 1,
    unitSize: 1,
    unitSizeUom: "EA",
    unitPrice: 1,
    extendedPrice: 1,
    ...overrides,
  }
}

describe("getLineItemBaseQty", () => {
  it("multiplies pack × size for Sysco-style case-pack lines (unit ≠ unitSizeUom)", () => {
    const result = getLineItemBaseQty(
      line({ quantity: 1, unit: "CS", packSize: 12, unitSize: 32, unitSizeUom: "OZ" })
    )
    expect(result).toEqual({ totalBaseQty: 384, baseUom: "OZ" })
  })

  it("treats quantity as the total for catch-weight meat lines (unit === unitSizeUom)", () => {
    // Premier Meats invoice 2262871: 6 CS @ $4.34, ext $1851.01
    // normalizeCatchWeightMeatLines rewrites to:
    //   quantity=426.5 LB, unit=LB, packSize=6 (carton count), unitSize=71.083 (lb/case), unitSizeUom=LB
    // The carton count is metadata for display; it must NOT multiply the total.
    const result = getLineItemBaseQty(
      line({
        quantity: 426.5,
        unit: "LB",
        packSize: 6,
        unitSize: 71.083,
        unitSizeUom: "LB",
      })
    )
    expect(result).toEqual({ totalBaseQty: 426.5, baseUom: "LB" })
  })

  it("handles bare loose-weight lines with no pack/size info", () => {
    const result = getLineItemBaseQty(
      line({
        quantity: 694.27,
        unit: "LB",
        packSize: null,
        unitSize: null,
        unitSizeUom: null,
      })
    )
    expect(result).toEqual({ totalBaseQty: 694.27, baseUom: "LB" })
  })

  it("collapses pack=1 size=1 catch-weight to plain quantity", () => {
    const result = getLineItemBaseQty(
      line({ quantity: 50, unit: "LB", packSize: 1, unitSize: 1, unitSizeUom: "LB" })
    )
    expect(result).toEqual({ totalBaseQty: 50, baseUom: "LB" })
  })

  it("returns null when totalBaseQty resolves to zero", () => {
    expect(
      getLineItemBaseQty(
        line({ quantity: 0, unit: "CS", packSize: 12, unitSize: 32, unitSizeUom: "OZ" })
      )
    ).toBeNull()
  })

  it("returns null when no UOM is available at all", () => {
    expect(
      getLineItemBaseQty(
        line({ quantity: 5, unit: null, packSize: null, unitSize: null, unitSizeUom: null })
      )
    ).toBeNull()
  })

  it("treats case-equivalent unit aliases as the same shape via canonicalizeUnit", () => {
    // "lb" and "LB" should both canonicalize to the same token, so this is the
    // already-in-base shape, not pack-converts-to-base.
    const result = getLineItemBaseQty(
      line({ quantity: 100, unit: "lb", packSize: 4, unitSize: 25, unitSizeUom: "LB" })
    )
    expect(result?.totalBaseQty).toBe(100)
  })
})

describe("deriveCostFromLineItem", () => {
  // Anchor regression test: this is the exact bug found 2026-05-17 where
  // Premier Meats ground beef showed $0.0103/lb instead of ~$4.34/lb because
  // the catch-weight carton metadata was being multiplied into totalBaseQty.
  it("derives ~$4.34/lb for a normalized Premier Meats catch-weight line", () => {
    const cost = deriveCostFromLineItem(
      {
        quantity: 426.5,
        unit: "LB",
        packSize: 6,
        unitSize: 71.083,
        unitSizeUom: "LB",
        unitPrice: 4.34,
        extendedPrice: 1851.01,
      },
      "lb"
    )
    expect(cost).not.toBeNull()
    expect(cost!).toBeGreaterThan(4)
    expect(cost!).toBeLessThan(5)
    // Within rounding of the invoice's own per-lb unit price.
    expect(cost!).toBeCloseTo(4.34, 2)
  })

  it("derives ~$4.34/lb on a loose-weight catch-weight line with no pack info", () => {
    const cost = deriveCostFromLineItem(
      {
        quantity: 694.27,
        unit: "LB",
        packSize: null,
        unitSize: null,
        unitSizeUom: null,
        unitPrice: 4.32,
        extendedPrice: 2999.25,
      },
      "lb"
    )
    expect(cost!).toBeCloseTo(4.32, 2)
  })

  it("converts Sysco case-pack lb cost to per-oz when recipeUnit is oz", () => {
    // 1 CS × 12 × 32 OZ = 384 OZ at $38.40 → $0.10/oz
    const cost = deriveCostFromLineItem(
      {
        quantity: 1,
        unit: "CS",
        packSize: 12,
        unitSize: 32,
        unitSizeUom: "OZ",
        unitPrice: 38.4,
        extendedPrice: 38.4,
      },
      "oz"
    )
    expect(cost).toBeCloseTo(0.1, 4)
  })

  it("returns null when extendedPrice and totalBaseQty have mismatched signs", () => {
    const cost = deriveCostFromLineItem(
      {
        quantity: 6,
        unit: "LB",
        packSize: null,
        unitSize: null,
        unitSizeUom: null,
        unitPrice: 4.34,
        extendedPrice: -1851.01,
      },
      "lb"
    )
    expect(cost).toBeNull()
  })

  it("preserves cost on negative-quantity returns where signs do match", () => {
    const cost = deriveCostFromLineItem(
      {
        quantity: -623.021,
        unit: "LB",
        packSize: 6,
        unitSize: 103.836,
        unitSizeUom: "LB",
        unitPrice: 4.32,
        extendedPrice: -2691.45,
      },
      "lb"
    )
    expect(cost!).toBeCloseTo(4.32, 2)
  })
})
