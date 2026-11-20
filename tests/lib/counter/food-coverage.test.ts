import { describe, it, expect } from "vitest"
import {
  foodGapNote,
  foodGapParts,
  foodKnown,
  withFoodGap,
} from "@/lib/counter/food-coverage"

const whole = { grossSales: 10_000, cogsValue: 3_000, cogsMissingDays: 0, uncostedSales: 0 }

describe("foodKnown", () => {
  it("is a reading only with sales and food posted against them", () => {
    expect(foodKnown(whole)).toBe(true)
    expect(foodKnown({ grossSales: 10_000, cogsValue: 0 })).toBe(false)
    expect(foodKnown({ grossSales: 0, cogsValue: 300 })).toBe(false)
    expect(foodKnown({ grossSales: -50, cogsValue: 300 })).toBe(false)
  })
})

describe("the partial label", () => {
  it("says nothing about a whole food cost", () => {
    expect(foodGapParts(whole)).toEqual([])
    expect(foodGapNote(whole)).toBeNull()
    expect(withFoodGap("Plan 28.0%", whole)).toBe("Plan 28.0%")
    expect(withFoodGap(undefined, whole)).toBeUndefined()
  })

  it("names days with no food cost, singular and plural, in the plain page's words", () => {
    expect(foodGapParts({ ...whole, cogsMissingDays: 1 })).toEqual(["1 day with no food cost"])
    expect(foodGapNote({ ...whole, cogsMissingDays: 3 })).toBe("partial · 3 days with no food cost")
  })

  it("names uncosted sales as a share, and a tiny one as under 1%", () => {
    expect(foodGapParts({ ...whole, uncostedSales: 1_200 })).toEqual(["12% of sales not fully costed"])
    expect(foodGapParts({ ...whole, uncostedSales: 20 })).toEqual(["under 1% of sales not fully costed"])
  })

  it("names both, most serious first, after the caption", () => {
    expect(withFoodGap("Ceiling 60.0%", { ...whole, cogsMissingDays: 2, uncostedSales: 500 })).toBe(
      "Ceiling 60.0% · partial · 2 days with no food cost · 5% of sales not fully costed",
    )
  })

  it("reads an old cached rollup without the fields as whole", () => {
    expect(foodGapNote({ grossSales: 10_000, cogsValue: 3_000 })).toBeNull()
  })
})
