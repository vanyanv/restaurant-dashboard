// The evidence table's derived columns. The intensity bar and the change
// column are computed from values already on screen, so they stay inside the
// never-invent-a-number rule — but the change column must be labelled for what
// it actually is (previous row), not implied to be a period-over-period one.

import { describe, it, expect } from "vitest"
import { buildTrendRows, trendTotal } from "@/lib/chat/trend-rows"

const pts = [
  { label: "Mon", value: 100 },
  { label: "Tue", value: 150 },
  { label: "Wed", value: 75 },
  { label: "Thu", value: 200 },
]

describe("buildTrendRows — change against the previous row", () => {
  it("leaves the first row without a change; it has nothing to compare to", () => {
    expect(buildTrendRows(pts)[0].delta).toBeNull()
  })

  it("computes the rise from the row above", () => {
    expect(buildTrendRows(pts)[1].delta).toEqual({ text: "+50.0%", direction: "up" })
  })

  it("computes the fall from the row above", () => {
    expect(buildTrendRows(pts)[2].delta).toEqual({ text: "-50.0%", direction: "down" })
  })

  it("treats a flat row as no movement rather than +0.0%", () => {
    const rows = buildTrendRows([{ label: "a", value: 10 }, { label: "b", value: 10 }])
    expect(rows[1].delta).toEqual({ text: "0.0%", direction: null })
  })

  it("does not divide by zero when the previous row was zero", () => {
    const rows = buildTrendRows([{ label: "a", value: 0 }, { label: "b", value: 40 }])
    expect(rows[1].delta).toBeNull()
  })

  it("handles a single point", () => {
    const rows = buildTrendRows([{ label: "only", value: 5 }])
    expect(rows).toHaveLength(1)
    expect(rows[0].delta).toBeNull()
  })

  it("handles an empty series", () => {
    expect(buildTrendRows([])).toEqual([])
  })
})

describe("buildTrendRows — intensity ramp", () => {
  it("gives the largest value the full bar", () => {
    const rows = buildTrendRows(pts)
    expect(rows[3].intensity).toBe(1)
  })

  it("scales the rest against the maximum", () => {
    const rows = buildTrendRows(pts)
    expect(rows[0].intensity).toBeCloseTo(0.5, 5)
    expect(rows[2].intensity).toBeCloseTo(0.375, 5)
  })

  it("buckets onto the sanctioned opacity ramp", () => {
    // 100/150/75/200 against a max of 200 -> .50 .75 .375 1.0
    const rows = buildTrendRows(pts)
    expect(rows.map((r) => r.ramp)).toEqual(["mid", "hi", "mid", "hi"])
  })

  it("drops to the faintest step below 30% of the maximum", () => {
    const rows = buildTrendRows([{ label: "a", value: 10 }, { label: "b", value: 100 }])
    expect(rows[0].ramp).toBe("lo")
  })

  it("does not divide by zero when every value is zero", () => {
    const rows = buildTrendRows([{ label: "a", value: 0 }, { label: "b", value: 0 }])
    expect(rows.every((r) => r.intensity === 0)).toBe(true)
  })

  it("clamps a negative value to an empty bar rather than a negative width", () => {
    const rows = buildTrendRows([{ label: "a", value: -20 }, { label: "b", value: 100 }])
    expect(rows[0].intensity).toBe(0)
  })
})

describe("trendTotal", () => {
  it("sums the series", () => {
    expect(trendTotal(pts)).toBe(525)
  })

  it("is zero for an empty series", () => {
    expect(trendTotal([])).toBe(0)
  })
})
