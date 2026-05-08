// Pure helper that converts a count entered in native units (e.g. "2 cases",
// "8 lb") into recipe units (e.g. "32 lb", "8 lb") using
// IngredientSkuMatch.conversionFactor + the from/to unit pair recorded on
// the match. Counts entered in the canonical ingredient's recipe unit pass
// through unchanged. Counts entered in a unit we have no conversion for are
// rejected — we never silently store an un-converted value, because the
// running on-hand calc operates strictly in recipe units.

import { describe, it, expect } from "vitest"
import {
  convertNativeToRecipeQty,
  type ConversionInputs,
} from "@/lib/inventory/unit-conversion"

const baseInputs: ConversionInputs = {
  nativeQty: 1,
  nativeUnit: "lb",
  recipeUnit: "lb",
  conversions: [],
}

describe("convertNativeToRecipeQty", () => {
  it("returns the same qty when native unit equals recipe unit (no conversion needed)", () => {
    const result = convertNativeToRecipeQty({ ...baseInputs, nativeQty: 12, nativeUnit: "lb", recipeUnit: "lb" })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.qtyInRecipeUnit).toBeCloseTo(12, 6)
  })

  it("normalizes case differences on unit names (Lb == lb == LB)", () => {
    const result = convertNativeToRecipeQty({ ...baseInputs, nativeQty: 5, nativeUnit: "Lb", recipeUnit: "LB" })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.qtyInRecipeUnit).toBeCloseTo(5, 6)
  })

  it("trims surrounding whitespace on unit names", () => {
    const result = convertNativeToRecipeQty({ ...baseInputs, nativeQty: 5, nativeUnit: " lb ", recipeUnit: "lb" })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.qtyInRecipeUnit).toBeCloseTo(5, 6)
  })

  it("applies a single matching conversion (case → lb at factor 16)", () => {
    const result = convertNativeToRecipeQty({
      nativeQty: 2,
      nativeUnit: "case",
      recipeUnit: "lb",
      conversions: [{ fromUnit: "case", toUnit: "lb", factor: 16 }],
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.qtyInRecipeUnit).toBeCloseTo(32, 6)
  })

  it("applies a fractional factor (gallon → fl oz at factor 128)", () => {
    const result = convertNativeToRecipeQty({
      nativeQty: 0.5,
      nativeUnit: "gal",
      recipeUnit: "fl oz",
      conversions: [{ fromUnit: "gal", toUnit: "fl oz", factor: 128 }],
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.qtyInRecipeUnit).toBeCloseTo(64, 6)
  })

  it("uses the matching conversion when several are present", () => {
    const result = convertNativeToRecipeQty({
      nativeQty: 3,
      nativeUnit: "case",
      recipeUnit: "lb",
      conversions: [
        { fromUnit: "bag", toUnit: "lb", factor: 5 },
        { fromUnit: "case", toUnit: "lb", factor: 16 },
        { fromUnit: "pallet", toUnit: "lb", factor: 1600 },
      ],
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.qtyInRecipeUnit).toBeCloseTo(48, 6)
  })

  it("matches conversions case-insensitively on the from/to units", () => {
    const result = convertNativeToRecipeQty({
      nativeQty: 1,
      nativeUnit: "Case",
      recipeUnit: "LB",
      conversions: [{ fromUnit: "CASE", toUnit: "lb", factor: 16 }],
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.qtyInRecipeUnit).toBeCloseTo(16, 6)
  })

  it("returns ok=false when no conversion exists for the (native, recipe) unit pair", () => {
    const result = convertNativeToRecipeQty({
      nativeQty: 1,
      nativeUnit: "case",
      recipeUnit: "lb",
      conversions: [{ fromUnit: "bag", toUnit: "lb", factor: 5 }],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe("missing_conversion")
      expect(result.fromUnit).toBe("case")
      expect(result.toUnit).toBe("lb")
    }
  })

  it("returns ok=false when a conversion exists but to a different recipe unit", () => {
    const result = convertNativeToRecipeQty({
      nativeQty: 1,
      nativeUnit: "case",
      recipeUnit: "lb",
      conversions: [{ fromUnit: "case", toUnit: "oz", factor: 256 }],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("missing_conversion")
  })

  it("rejects negative native qty (counts can't be negative)", () => {
    const result = convertNativeToRecipeQty({ ...baseInputs, nativeQty: -1, nativeUnit: "lb", recipeUnit: "lb" })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("invalid_qty")
  })

  it("rejects non-finite native qty (NaN, Infinity)", () => {
    expect(convertNativeToRecipeQty({ ...baseInputs, nativeQty: NaN }).ok).toBe(false)
    expect(convertNativeToRecipeQty({ ...baseInputs, nativeQty: Infinity }).ok).toBe(false)
  })

  it("rejects empty / null unit names", () => {
    const r1 = convertNativeToRecipeQty({ ...baseInputs, nativeQty: 1, nativeUnit: "" })
    const r2 = convertNativeToRecipeQty({ ...baseInputs, nativeQty: 1, nativeUnit: "   " })
    const r3 = convertNativeToRecipeQty({ ...baseInputs, nativeQty: 1, recipeUnit: "" })
    expect(r1.ok).toBe(false)
    expect(r2.ok).toBe(false)
    expect(r3.ok).toBe(false)
    if (!r1.ok) expect(r1.reason).toBe("invalid_unit")
  })

  it("permits zero native qty (you can count zero of something)", () => {
    const result = convertNativeToRecipeQty({ ...baseInputs, nativeQty: 0, nativeUnit: "lb", recipeUnit: "lb" })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.qtyInRecipeUnit).toBe(0)
  })

  it("rejects non-positive conversion factors", () => {
    const result = convertNativeToRecipeQty({
      nativeQty: 1,
      nativeUnit: "case",
      recipeUnit: "lb",
      conversions: [{ fromUnit: "case", toUnit: "lb", factor: 0 }],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("missing_conversion")
  })
})
