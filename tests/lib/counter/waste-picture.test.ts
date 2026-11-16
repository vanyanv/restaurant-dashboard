// "Thrown out", added up: the Waste tab's headline, its bars and the
// Inventory overview's tile are all `summarizeWaste`. The rule under test is
// that an entry with no price is listed and counted, never added in as $0.

import { describe, it, expect } from "vitest"
import { barShares, mergeWaste, moneyChange, summarizeWaste } from "@/lib/counter/waste-picture"

describe("summarizeWaste", () => {
  it("adds the priced entries and says how many that is", () => {
    const s = summarizeWaste([
      { reason: "EXPIRY", dollars: 10 },
      { reason: "EXPIRY", dollars: null },
      { reason: "DROPPED", dollars: 4.5 },
    ])
    expect(s).toMatchObject({ entries: 3, valued: 2, unpriced: 1, dollars: 14.5 })
  })

  it("is an unknown, not $0, when no entry has a price", () => {
    const s = summarizeWaste([{ reason: "EXPIRY", dollars: null }, { reason: "BURNT", dollars: null }])
    expect(s.dollars).toBeNull()
    expect(s).toMatchObject({ entries: 2, valued: 0, unpriced: 2 })
    expect(s.reasons.every((r) => r.dollars === null)).toBe(true)
  })

  it("is an unknown with nothing logged, and a real $0 for a priced entry worth nothing", () => {
    expect(summarizeWaste([]).dollars).toBeNull()
    expect(summarizeWaste([{ reason: "DROPPED", dollars: 0 }]).dollars).toBe(0)
  })

  it("gives one bar per reason, biggest first, with a reason nobody can value last", () => {
    const s = summarizeWaste([
      { reason: "REMAKE", dollars: 2 },
      { reason: "BURNT", dollars: null },
      { reason: "EXPIRY", dollars: 9 },
      { reason: "EXPIRY", dollars: null },
      { reason: "DROPPED", dollars: 5 },
    ])
    expect(s.reasons.map((r) => [r.label, r.entries, r.unpriced, r.dollars])).toEqual([
      ["Went bad", 2, 1, 9],
      ["Dropped", 1, 0, 5],
      ["Remake", 1, 0, 2],
      ["Burnt", 1, 1, null],
    ])
    // The bars add up to the headline.
    expect(s.reasons.reduce((t, r) => t + (r.dollars ?? 0), 0)).toBe(s.dollars)
  })
})

describe("mergeWaste", () => {
  it("adds stores up reason by reason, and stays unknown when none has a price", () => {
    const a = summarizeWaste([{ reason: "EXPIRY", dollars: 10 }, { reason: "DROPPED", dollars: null }])
    const b = summarizeWaste([{ reason: "EXPIRY", dollars: null }, { reason: "DROPPED", dollars: null }])
    const all = mergeWaste([a, b, summarizeWaste([])])
    expect(all).toMatchObject({ entries: 4, valued: 1, unpriced: 3, dollars: 10 })
    expect(all.reasons.map((r) => [r.label, r.entries, r.unpriced, r.dollars])).toEqual([
      ["Went bad", 2, 1, 10],
      ["Dropped", 2, 2, null],
    ])
    expect(mergeWaste([b]).dollars).toBeNull()
    expect(mergeWaste([]).dollars).toBeNull()
  })
})

describe("moneyChange", () => {
  const fig = (entries: number, dollars: number | null) => ({ entries, dollars })

  it("compares two real figures", () => {
    expect(moneyChange(fig(3, 30), fig(2, 18))).toEqual({ kind: "more", dollars: 12 })
    expect(moneyChange(fig(1, 5), fig(2, 18))).toEqual({ kind: "less", dollars: 13 })
    expect(moneyChange(fig(1, 18), fig(4, 18))).toEqual({ kind: "same" })
  })

  it("reads nothing logged this week as a real drop to nothing", () => {
    expect(moneyChange(fig(0, null), fig(2, 18))).toEqual({ kind: "less", dollars: 18 })
  })

  it("never calls an empty week before a rise from $0", () => {
    expect(moneyChange(fig(3, 30), fig(0, null))).toEqual({ kind: "nothing_before" })
  })

  it("can't tell when one side has entries and no prices", () => {
    expect(moneyChange(fig(3, null), fig(2, 18))).toEqual({ kind: "cant_tell" })
    expect(moneyChange(fig(3, 30), fig(2, null))).toEqual({ kind: "cant_tell" })
  })

  it("says nothing when neither week has an entry", () => {
    expect(moneyChange(fig(0, null), fig(0, null))).toBeNull()
  })
})

describe("barShares", () => {
  it("puts every bar on the scale of the biggest, and draws nothing for an unknown", () => {
    expect(barShares([20, 5, null, 0])).toEqual([1, 0.25, 0, 0])
    expect(barShares([null, null])).toEqual([0, 0])
    expect(barShares([])).toEqual([])
  })
})
