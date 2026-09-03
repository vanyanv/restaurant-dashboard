/**
 * The comparison, once — the contract two pages now share.
 *
 * `comparisonContext` and `comparisonPhrase` were private to
 * `adapters/overview.ts` until the P&L became the second page to print a
 * change against the same window. These tests pin the three things that would
 * silently differ if either page kept its own copy: the weekday divisor, the
 * flat window, and the tone of an absent comparison.
 */
import { describe, it, expect } from "vitest"

import { comparisonContext, comparisonPhrase } from "@/lib/counter/comparison"
import type { Statement } from "@/lib/counter/statement"

/** Only `grossSales` is read by these tests; the rest of a `Statement` is irrelevant here. */
const scope = { grossSales: 1000 } as Statement

describe("comparisonContext", () => {
  it("is off when the reader chose no comparison, even with a scope loaded", () => {
    expect(comparisonContext("none", scope).on).toBe(false)
  })

  it("is off when a comparison was chosen and its rollup did not load", () => {
    expect(comparisonContext("prev", null).on).toBe(false)
  })

  it("divides the weekday window by its four occurrences, and nothing else by anything", () => {
    expect(comparisonContext("weekday", scope).divisor).toBe(4)
    expect(comparisonContext("prev", scope).divisor).toBe(1)
    expect(comparisonContext("year", scope).divisor).toBe(1)
  })

  it("strips the leading 'vs' so both labels read inside a sentence", () => {
    const c = comparisonContext("prev", scope)
    expect(c.label.startsWith("vs ")).toBe(false)
    expect(c.short.startsWith("vs ")).toBe(false)
  })
})

describe("comparisonPhrase", () => {
  it("names the absence and paints it flat, never as a rise", () => {
    const r = comparisonPhrase(1000, comparisonContext("none", scope), 900)
    expect(r.text).toBe("no comparison set")
    expect(r.tone).toBe("is-flat")
  })

  it("applies the divisor to the comparison window's money", () => {
    // Four occurrences totalling $4,000 is $1,000 a period: flat, not +300%.
    const r = comparisonPhrase(1000, comparisonContext("weekday", scope), 4000)
    expect(r.text).toBe("flat vs the same 4 weekdays")
  })

  it("reads a fall as a fall, and classes it", () => {
    const r = comparisonPhrase(900, comparisonContext("prev", scope), 1000)
    expect(r.text).toBe("▼ 10.0% vs the prior period")
    expect(r.tone).toBe("is-down")
  })

  it("leaves a rise unclassed, because `.d` already paints a rise", () => {
    const r = comparisonPhrase(1100, comparisonContext("prev", scope), 1000)
    expect(r.text).toBe("▲ 10.0% vs the prior period")
    expect(r.tone).toBeUndefined()
  })

  it("says there is nothing to compare rather than dividing by zero", () => {
    const r = comparisonPhrase(1000, comparisonContext("prev", scope), 0)
    expect(r.text).toBe("nothing in the prior period to compare")
    expect(r.tone).toBe("is-flat")
  })

  /*
   * The article belongs to the LABEL, and the sentence has to take it.
   *
   * This previously asserted "no the prior period to compare" — the string the
   * code emitted rather than the sentence it meant — so the fault was pinned
   * instead of caught. All three labels are checked here because every one of
   * them carries "the": they are written to follow the word "vs".
   */
  it("reads as English against every comparison the picker offers", () => {
    const of = (id: Parameters<typeof comparisonContext>[0]) =>
      comparisonPhrase(1000, comparisonContext(id, scope), 0).text
    expect(of("prev")).toBe("nothing in the prior period to compare")
    expect(of("weekday")).toBe("nothing in the same 4 weekdays to compare")
    expect(of("year")).toBe("nothing in the same days last year to compare")
  })
})
