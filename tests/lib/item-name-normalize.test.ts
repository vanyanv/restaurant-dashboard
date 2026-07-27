// item-name-normalize — shared name normalization for POS-item ↔ recipe
// resolution. Pins: punctuation/whitespace/case folding, and stripping the
// "[Category]" suffix the proposal LLM copies from its vocabulary list.

import { describe, it, expect } from "vitest"

import { normalizeItemName, stripCategoryBracket } from "@/lib/item-name-normalize"

describe("normalizeItemName", () => {
  it("folds case, punctuation, and whitespace runs", () => {
    expect(normalizeItemName("Straight-Cut Fries")).toBe("straight cut fries")
    expect(normalizeItemName("Straight Cut Fries ")).toBe("straight cut fries")
    expect(normalizeItemName("  STRAIGHT   CUT FRIES")).toBe("straight cut fries")
  })

  it("treats apostrophes and parens as separators consistently", () => {
    expect(normalizeItemName("Extra Chris N Eddy's Sauce")).toBe("extra chris n eddy s sauce")
    expect(normalizeItemName("Vanilla Shake (20 oz cup)")).toBe("vanilla shake 20 oz cup")
  })
})

describe("stripCategoryBracket", () => {
  it("removes a trailing [Category] tag with surrounding whitespace", () => {
    expect(stripCategoryBracket("Water [Drinks]")).toBe("Water")
    expect(stripCategoryBracket("Mexican Sprite 500ml [Drinks]")).toBe("Mexican Sprite 500ml")
    expect(stripCategoryBracket("Strawberry Shake  []")).toBe("Strawberry Shake")
  })

  it("leaves names without a trailing bracket untouched", () => {
    expect(stripCategoryBracket("Double Slider")).toBe("Double Slider")
    expect(stripCategoryBracket("Signature Slider (Chris' Way)")).toBe(
      "Signature Slider (Chris' Way)"
    )
  })
})
