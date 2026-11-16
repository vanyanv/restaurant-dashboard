// "Went missing", between two counts: the headline, what it covers and which
// rows match. One set of rules for the Report tab, the Overview tile, the
// by-store comparison and the one-item page.

import { describe, it, expect } from "vitest"
import { gapBars, gapCoverage, gapHeadline, gapMatches, gapVerdict } from "@/lib/counter/gap-picture"

describe("gapHeadline", () => {
  it("adds the shortages only: an extra is never netted against them", () => {
    expect(gapHeadline([{ missingDollars: 50 }, { missingDollars: -200 }, { missingDollars: 12.5 }])).toEqual({
      items: 3, unpriced: 0, missingDollars: 62.5,
    })
  })

  it("leaves an item with no price out, and says how many", () => {
    expect(gapHeadline([{ missingDollars: 50 }, { missingDollars: null }])).toEqual({ items: 2, unpriced: 1, missingDollars: 50 })
  })

  it("is an unknown, not $0, when nothing was compared or nothing compared has a price", () => {
    expect(gapHeadline([]).missingDollars).toBeNull()
    expect(gapHeadline([{ missingDollars: null }, { missingDollars: null }])).toEqual({ items: 2, unpriced: 2, missingDollars: null })
  })

  it("is a real $0 when everything compared is priced and nothing is short", () => {
    expect(gapHeadline([{ missingDollars: 0 }, { missingDollars: -4 }]).missingDollars).toBe(0)
  })
})

describe("gapVerdict", () => {
  it("matches within 5% of the bigger amount", () => {
    expect(gapMatches({ should: 100, counted: 96, missing: 4 })).toBe(true)
    expect(gapVerdict({ should: 100, counted: 96, missing: 4 })).toBe("match")
    expect(gapVerdict({ should: 100, counted: 94, missing: 6 })).toBe("short")
    expect(gapVerdict({ should: 100, counted: 110, missing: -10 })).toBe("extra")
  })

  it("does not call two empty shelves a gap, nor a real one a match", () => {
    expect(gapVerdict({ should: 0, counted: 0, missing: 0 })).toBe("match")
    expect(gapVerdict({ should: 3, counted: 0, missing: 3 })).toBe("short")
  })
})

describe("gapBars", () => {
  it("draws both bars on the scale of the bigger", () => {
    expect(gapBars({ should: 200, counted: 50 })).toEqual({ should: 1, counted: 0.25 })
    expect(gapBars({ should: 50, counted: 200 })).toEqual({ should: 0.25, counted: 1 })
  })

  it("draws an empty bar for a should-have below zero, and nothing for two empties", () => {
    expect(gapBars({ should: -569, counted: 175.5 })).toEqual({ should: 0, counted: 1 })
    expect(gapBars({ should: 0, counted: 0 })).toEqual({ should: 0, counted: 0 })
    expect(gapBars({ should: -5, counted: 0 })).toEqual({ should: 0, counted: 0 })
  })
})

describe("gapCoverage", () => {
  const cover = (compared: string[]) =>
    gapCoverage({
      // Beef is counted at two stops: two lines, one item.
      lineItems: ["beef", "beef", "buns", "cups", "lids", "salt"],
      countLines: [
        { canonicalIngredientId: "beef", nativeUnit: "lb" },
        { canonicalIngredientId: "buns", nativeUnit: "partial" },
        { canonicalIngredientId: "cups", nativeUnit: null },
        { canonicalIngredientId: "lids", nativeUnit: "each" },
      ],
      compared,
    })

  it("says how many lines were compared, and why each of the rest was not", () => {
    const c = cover(["beef", "cups"])
    expect(c).toEqual({ lines: 6, compared: 3, noSize: 1, notOnThis: 1, notOnLast: 1 })
    expect(c.compared + c.noSize + c.notOnThis + c.notOnLast).toBe(c.lines)
  })

  it("counts nothing as compared when there is no row", () => {
    expect(cover([])).toEqual({ lines: 6, compared: 0, noSize: 1, notOnThis: 1, notOnLast: 4 })
  })
})
