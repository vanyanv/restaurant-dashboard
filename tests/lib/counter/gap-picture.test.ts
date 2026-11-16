// "Went missing", between two counts: the headline, what it covers and which
// rows match. One set of rules for the Report tab, the Overview tile, the
// by-store comparison and the one-item page.

import { describe, it, expect } from "vitest"
import { biggestShort, gapBars, gapChange, gapCoverage, gapHeadline, gapMatches, gapVerdict } from "@/lib/counter/gap-picture"

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

describe("gapChange", () => {
  const row = (ingredientId: string, missingDollars: number | null) => ({ ingredientId, missingDollars })

  it("compares the two pairs outright when they compared the same items", () => {
    const now = [row("a", 30), row("b", -5), row("c", 10)]
    const before = [row("a", 10), row("b", 4), row("c", 10)]
    // Shortages only: now 40, before 24.
    expect(gapChange(now, before)).toEqual({ kind: "more", dollars: 16, items: 3, sameItems: true })
    expect(gapChange(before, now)).toEqual({ kind: "less", dollars: 16, items: 3, sameItems: true })
    expect(gapChange(now, now)).toEqual({ kind: "same", items: 3, sameItems: true })
  })

  it("after a partial recount, compares only the items in both and says so", () => {
    // Full, full, then a 3-line recount: the pair before compared 6 items, this one 3.
    const before = [row("a", 10), row("b", 20), row("c", 0), row("d", 100), row("e", 50), row("f", 5)]
    const recount = [row("a", 12), row("b", 0), row("c", 8)]
    // The headlines are $20 and $185: "$165 less" would be the size of the count, not of the gap.
    expect(gapHeadline(recount).missingDollars).toBe(20)
    expect(gapHeadline(before).missingDollars).toBe(185)
    // On a, b and c alone: 20 now against 30 before.
    expect(gapChange(recount, before)).toEqual({ kind: "less", dollars: 10, items: 3, sameItems: false })
    // And the other way round: a full count after a recount.
    expect(gapChange(before, recount)).toEqual({ kind: "more", dollars: 10, items: 3, sameItems: false })
  })

  it("has no comparison when no item was compared both times", () => {
    expect(gapChange([row("a", 12)], [row("x", 50), row("y", 5)])).toEqual({ kind: "no_items_in_both" })
    expect(gapChange([], [row("x", 50)])).toEqual({ kind: "no_items_in_both" })
  })

  it("leaves an item with no price out of both sides, and can't tell when none has one", () => {
    expect(gapChange([row("a", 12), row("b", null)], [row("a", 2), row("b", null)])).toEqual({ kind: "more", dollars: 10, items: 1, sameItems: true })
    expect(gapChange([row("b", null)], [row("b", null)])).toEqual({ kind: "cant_tell" })
  })
})

describe("biggestShort", () => {
  const row = (name: string, should: number, counted: number, cost: number) => ({ name, should, counted, missing: should - counted, missingDollars: (should - counted) * cost })

  it("names only rows the list calls short, biggest first", () => {
    const rows = [
      row("Cups", 1000, 960, 1), // $40 gap, but within 5%: a match on the list
      row("Fries", 100, 80, 1.5), // $30 short
      row("Buns", 50, 10, 2), // $80 short
      row("Oil", 10, 30, 5), // extra
    ]
    expect(biggestShort(rows).map((r) => r.name)).toEqual(["Buns", "Fries"])
    expect(biggestShort(rows, 1).map((r) => r.name)).toEqual(["Buns"])
  })

  it("names nothing when the whole total is small gaps on rows that match", () => {
    const rows = [row("Cups", 1000, 960, 1), row("Lids", 2000, 1950, 1)]
    // $90 "went missing", and every row is a match: there is no item to point at.
    expect(gapHeadline(rows).missingDollars).toBe(90)
    expect(rows.every((r) => gapVerdict(r) === "match")).toBe(true)
    expect(biggestShort(rows)).toEqual([])
  })
})
