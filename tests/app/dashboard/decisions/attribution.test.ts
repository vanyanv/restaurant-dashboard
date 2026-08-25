// The forecast has always known why it predicted each number — XGBoost returns
// exact TreeSHAP contributions as a by-product — and the page showed three grey
// dots instead. ml/models/attribution.py groups them into things an owner
// recognises and stores the waterfall on the forecast row.
//
// Two jobs on this side: parse a payload that arrives as untyped JSON from the
// database, and merge across stores for the portfolio view. Merging is legitimate
// because SHAP contributions are additive — two stores' "Day of week" effects sum
// the same way their forecasts do.

import { describe, it, expect } from "vitest"
import {
  mergeAttributions,
  parseAttribution,
} from "@/app/dashboard/(editorial)/decisions/lib/attribution"

const wf = (base: number, groups: [string, number][]) => ({
  base,
  groups: groups.map(([label, value]) => ({ label, value })),
})

describe("parseAttribution", () => {
  it("reads a well-formed payload", () => {
    const a = parseAttribution(wf(6000, [["Day of week", 900]]))
    expect(a).toEqual({ base: 6000, groups: [{ label: "Day of week", value: 900 }] })
  })

  it("returns null for anything that isn't one", () => {
    for (const bad of [null, undefined, 42, "x", [], {}, { base: 1 }, { groups: [] }]) {
      expect(parseAttribution(bad)).toBeNull()
    }
  })

  it("drops malformed group entries rather than rendering NaN", () => {
    const a = parseAttribution({
      base: 5000,
      groups: [
        { label: "Weather", value: 100 },
        { label: "Nearby events" },
        { value: 50 },
        { label: "Holiday", value: "big" },
      ],
    })
    expect(a?.groups).toEqual([{ label: "Weather", value: 100 }])
  })

  it("rejects a non-finite base — a chart that cannot add up is worse than none", () => {
    expect(parseAttribution({ base: Number.NaN, groups: [] })).toBeNull()
  })
})

describe("mergeAttributions", () => {
  it("passes a single store through", () => {
    const merged = mergeAttributions([wf(6000, [["Day of week", 900]])])
    expect(merged).toEqual({ base: 6000, groups: [{ label: "Day of week", value: 900 }] })
  })

  it("sums bases and like-labelled groups across stores", () => {
    const merged = mergeAttributions([
      wf(6000, [["Day of week", 900], ["Weather", -100]]),
      wf(4000, [["Day of week", 600], ["Nearby events", 250]]),
    ])
    expect(merged?.base).toBe(10000)
    expect(merged?.groups).toEqual([
      { label: "Day of week", value: 1500 },
      { label: "Nearby events", value: 250 },
      { label: "Weather", value: -100 },
    ])
  })

  it("re-sorts by magnitude after merging, since the order can change", () => {
    const merged = mergeAttributions([
      wf(1000, [["Weather", 400], ["Day of week", 300]]),
      wf(1000, [["Day of week", 500]]),
    ])
    expect(merged?.groups.map((g) => g.label)).toEqual(["Day of week", "Weather"])
  })

  it("keeps the total intact — the merged waterfall still adds up", () => {
    const parts = [
      wf(6000, [["Day of week", 900], ["Weather", -100]]),
      wf(4000, [["Day of week", 600], ["Nearby events", 250]]),
    ]
    const expected = parts.reduce(
      (s, p) => s + p.base + p.groups.reduce((t, g) => t + g.value, 0), 0,
    )
    const merged = mergeAttributions(parts)!
    const actual = merged.base + merged.groups.reduce((t, g) => t + g.value, 0)
    expect(actual).toBeCloseTo(expected, 6)
  })

  it("skips stores with no attribution instead of failing the whole day", () => {
    const merged = mergeAttributions([wf(6000, [["Weather", 100]]), null, undefined])
    expect(merged?.base).toBe(6000)
  })

  it("returns null when nothing usable came back", () => {
    expect(mergeAttributions([])).toBeNull()
    expect(mergeAttributions([null, undefined])).toBeNull()
  })

  it("drops a group that cancels to nothing once merged", () => {
    const merged = mergeAttributions([
      wf(1000, [["Weather", 500], ["Day of week", 200]]),
      wf(1000, [["Weather", -500]]),
    ])
    expect(merged?.groups.map((g) => g.label)).toEqual(["Day of week"])
  })
})
