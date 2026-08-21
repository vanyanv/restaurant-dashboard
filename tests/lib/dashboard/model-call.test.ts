import { describe, it, expect } from "vitest"
import {
  buildWaterfall,
  mergeAttributions,
  parseAttribution,
  readInterval,
  type Attribution,
} from "@/lib/dashboard/model-call"

describe("parseAttribution", () => {
  it("reads the shape the Python pipeline writes", () => {
    expect(
      parseAttribution({
        base: 5180,
        groups: [
          { label: "Weekday", value: 310 },
          { label: "Weather", value: -140 },
        ],
      })
    ).toEqual({
      base: 5180,
      groups: [
        { label: "Weekday", value: 310 },
        { label: "Weather", value: -140 },
      ],
    })
  })

  it("drops malformed groups instead of throwing on the dashboard's hot path", () => {
    const a = parseAttribution({
      base: 100,
      groups: [
        { label: "Good", value: 10 },
        { label: "", value: 5 },
        { label: "NoValue" },
        { value: 7 },
        "nonsense",
        { label: "NaN", value: Number.NaN },
      ],
    })
    expect(a).toEqual({ base: 100, groups: [{ label: "Good", value: 10 }] })
  })

  it("returns null for anything it cannot trust", () => {
    expect(parseAttribution(null)).toBeNull()
    expect(parseAttribution(undefined)).toBeNull()
    expect(parseAttribution("{}")).toBeNull()
    expect(parseAttribution([])).toBeNull()
    expect(parseAttribution({ groups: [] })).toBeNull()
    expect(parseAttribution({ base: 100 })).toBeNull()
    expect(parseAttribution({ base: "100", groups: [{ label: "a", value: 1 }] })).toBeNull()
    expect(parseAttribution({ base: 100, groups: [] })).toBeNull()
  })
})

describe("mergeAttributions", () => {
  it("returns the single attribution untouched", () => {
    const one: Attribution = { base: 10, groups: [{ label: "A", value: 1 }] }
    expect(mergeAttributions([one])).toBe(one)
  })

  it("adds bases and matches groups by label", () => {
    const merged = mergeAttributions([
      { base: 100, groups: [{ label: "Weekday", value: 10 }, { label: "Weather", value: -5 }] },
      { base: 200, groups: [{ label: "Weekday", value: 20 }] },
    ])
    expect(merged).toEqual({
      base: 300,
      groups: [
        { label: "Weekday", value: 30 },
        { label: "Weather", value: -5 },
      ],
    })
  })

  it("returns null with nothing to merge", () => {
    expect(mergeAttributions([])).toBeNull()
  })
})

describe("buildWaterfall", () => {
  const a: Attribution = {
    base: 5180,
    groups: [
      { label: "Weekday", value: 310 },
      { label: "Weather", value: -140 },
      { label: "Menu", value: 120 },
      { label: "Trend", value: 140 },
    ],
  }

  it("reconciles base plus every bar to the total", () => {
    const w = buildWaterfall(a)!
    expect(w.base).toBe(5180)
    expect(w.total).toBe(5610)
    const summed = w.base + w.bars.reduce((s, b) => s + b.value, 0)
    expect(summed).toBeCloseTo(w.total, 6)
  })

  it("orders bars by magnitude so the biggest mover reads first", () => {
    const w = buildWaterfall({
      base: 1000,
      groups: [
        { label: "Small", value: 20 },
        { label: "Largest", value: -300 },
        { label: "Middle", value: 90 },
      ],
    })!
    expect(w.bars.map((b) => b.label)).toEqual(["Largest", "Middle", "Small"])
  })

  it("keeps payload order when two groups tie on magnitude", () => {
    // Weather (-140) and Trend (+140) are the same size. A stable sort keeps
    // the pipeline's own ordering rather than shuffling equals run to run.
    const w = buildWaterfall(a)!
    expect(w.bars.map((b) => b.label)).toEqual([
      "Weekday",
      "Weather",
      "Trend",
      "Menu",
    ])
  })

  it("marks direction from the sign", () => {
    const w = buildWaterfall(a)!
    const weather = w.bars.find((b) => b.label === "Weather")!
    expect(weather.direction).toBe("down")
    expect(w.bars.find((b) => b.label === "Menu")!.direction).toBe("up")
  })

  it("folds slivers into one Other bar and still reconciles", () => {
    const w = buildWaterfall({
      base: 1000,
      groups: [
        { label: "Big", value: 200 },
        { label: "Tiny1", value: 1 },
        { label: "Tiny2", value: 2 },
      ],
    })!
    expect(w.bars.map((b) => b.label)).toEqual(["Big", "Other"])
    expect(w.bars.find((b) => b.label === "Other")!.value).toBe(3)
    expect(w.base + w.bars.reduce((s, b) => s + b.value, 0)).toBeCloseTo(w.total, 6)
  })

  it("caps the bar count and still reconciles", () => {
    const w = buildWaterfall(
      {
        base: 1000,
        groups: Array.from({ length: 9 }, (_, i) => ({
          label: `G${i}`,
          value: 100 - i * 5,
        })),
      },
      { maxBars: 3 }
    )!
    expect(w.bars).toHaveLength(4) // 3 + Other
    expect(w.base + w.bars.reduce((s, b) => s + b.value, 0)).toBeCloseTo(w.total, 6)
  })

  it("refuses a nonsensical base", () => {
    expect(buildWaterfall({ base: 0, groups: [{ label: "A", value: 1 }] })).toBeNull()
    expect(buildWaterfall({ base: -5, groups: [{ label: "A", value: 1 }] })).toBeNull()
  })
})

describe("readInterval", () => {
  it("places the actual on the p10-p90 track", () => {
    const r = readInterval({ p10: 4980, p90: 6340, forecast: 5610, actual: 5240 })!
    expect(r.markPct).toBeCloseTo((5240 - 4980) / (6340 - 4980), 6)
    expect(r.forecastPct).toBeCloseTo((5610 - 4980) / (6340 - 4980), 6)
    expect(r.inside).toBe(true)
  })

  it("clamps and flags an actual outside the interval", () => {
    const low = readInterval({ p10: 4980, p90: 6340, forecast: 5610, actual: 3000 })!
    expect(low.markPct).toBe(0)
    expect(low.inside).toBe(false)

    const high = readInterval({ p10: 4980, p90: 6340, forecast: 5610, actual: 9000 })!
    expect(high.markPct).toBe(1)
    expect(high.inside).toBe(false)
  })

  it("refuses to draw a collapsed or missing interval", () => {
    expect(readInterval({ p10: null, p90: 6340, forecast: 1, actual: 1 })).toBeNull()
    expect(readInterval({ p10: 4980, p90: null, forecast: 1, actual: 1 })).toBeNull()
    expect(readInterval({ p10: 5000, p90: 5000, forecast: 1, actual: 1 })).toBeNull()
    expect(readInterval({ p10: 6000, p90: 5000, forecast: 1, actual: 1 })).toBeNull()
  })
})
