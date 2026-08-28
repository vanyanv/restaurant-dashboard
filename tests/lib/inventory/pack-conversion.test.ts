// `convertDelivered` / `sumDeliveries` — turning a case-priced invoice line
// into the ingredient's recipe unit.
//
// This is the arithmetic that decides on-hand quantity, and on-hand quantity
// times cost is a dollar figure the owner reads, so it is tested.
//
// The defect these cover, measured 2026-08-28 against the live account:
// `InvoiceLineItem.unit` is "CS" on all but a handful of 1,667 lines and
// `recipeUnit` is each / oz / gal / ml / lb. Nothing converts a case to an
// each dimensionally, so every delivery was dropped and marked partial while
// depletion (already in recipe units) converted fine. 72 of 76 ingredients
// were partial, 31 held a negative on-hand, and Σ(cost × onHand) was
// −$372,975. The factor was on the same row the whole time.

import { describe, it, expect } from "vitest"
import { convertDelivered, sumDeliveries } from "@/lib/inventory/usage-math"

const CASE_OF_1000 = {
  caseUnit: "CS",
  recipeUnitsPerCase: 1000,
  innerPackUnit: "PK",
  innerPacksPerCase: 20,
}

describe("convertDelivered", () => {
  it("converts a case to recipe units through the pack definition", () => {
    // Paper patty 5.5x5.5: 1,000 each to the case. Two cases is 2,000.
    expect(convertDelivered(2, "CS", "each", CASE_OF_1000)).toBe(2000)
  })

  it("matches the case unit case-insensitively and with surrounding space", () => {
    // The extractor writes "CS"; the pack was typed as "cs" on some rows.
    expect(convertDelivered(1, " cs ", "each", CASE_OF_1000)).toBe(1000)
  })

  it("converts an inner pack as a fraction of the case", () => {
    // 1,000 each per case, 20 packs per case → 50 each per pack.
    expect(convertDelivered(3, "PK", "each", CASE_OF_1000)).toBe(150)
  })

  it("uses the pack even when the recipe unit is dimensional", () => {
    // House sauce: 256 oz to the case. "CS" -> "oz" has no dimensional route.
    expect(
      convertDelivered(4, "CS", "oz", {
        caseUnit: "CS",
        recipeUnitsPerCase: 256,
        innerPackUnit: null,
        innerPacksPerCase: null,
      }),
    ).toBe(1024)
  })

  it("handles a case unit that is not CS", () => {
    // American cheese is invoiced in LB and counted in slices: 32 to the pound.
    expect(
      convertDelivered(10, "LB", "each", {
        caseUnit: "LB",
        recipeUnitsPerCase: 32,
        innerPackUnit: null,
        innerPacksPerCase: null,
      }),
    ).toBe(320)
  })

  it("falls through to dimensional conversion when the pack does not match", () => {
    // A line in LB against an ingredient packed in cases: the pack says
    // nothing, but pounds to pounds is still a conversion.
    expect(convertDelivered(5, "LB", "lb", CASE_OF_1000)).toBe(5)
  })

  it("still returns null when nothing converts it", () => {
    // "SCS" is not the case unit and is not a dimensional unit. Dropping it is
    // the honest outcome; `partial` is what says so.
    expect(convertDelivered(1, "SCS", "each", CASE_OF_1000)).toBeNull()
  })

  it("ignores a pack whose factor is missing or zero", () => {
    expect(
      convertDelivered(1, "CS", "each", {
        caseUnit: "CS",
        recipeUnitsPerCase: null,
        innerPackUnit: null,
        innerPacksPerCase: null,
      }),
    ).toBeNull()
    expect(
      convertDelivered(1, "CS", "each", {
        caseUnit: "CS",
        recipeUnitsPerCase: 0,
        innerPackUnit: null,
        innerPacksPerCase: null,
      }),
    ).toBeNull()
  })

  it("behaves exactly as before when no pack is supplied", () => {
    expect(convertDelivered(1, "CS", "each", null)).toBeNull()
    expect(convertDelivered(1, "CS", "each")).toBeNull()
    expect(convertDelivered(7, "lb", "lb")).toBe(7)
  })
})

describe("sumDeliveries", () => {
  it("sums converted cases instead of dropping them", () => {
    const lines = [
      { quantity: 2, unit: "CS" },
      { quantity: 1, unit: "CS" },
    ]
    // Without the pack this was 0 and partial — the whole defect in one case.
    expect(sumDeliveries(lines, "each", CASE_OF_1000)).toEqual({
      deliveriesQty: 3000,
      partial: false,
    })
    expect(sumDeliveries(lines, "each")).toEqual({
      deliveriesQty: 0,
      partial: true,
    })
  })

  it("marks partial for the line it could not convert and keeps the rest", () => {
    const lines = [
      { quantity: 1, unit: "CS" },
      { quantity: 1, unit: "SCS" },
    ]
    expect(sumDeliveries(lines, "each", CASE_OF_1000)).toEqual({
      deliveriesQty: 1000,
      partial: true,
    })
  })

  it("treats a null unit as already in the recipe unit", () => {
    expect(sumDeliveries([{ quantity: 4, unit: null }], "each", CASE_OF_1000)).toEqual({
      deliveriesQty: 4,
      partial: false,
    })
  })
})
