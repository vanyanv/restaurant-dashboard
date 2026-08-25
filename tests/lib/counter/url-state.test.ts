import { describe, it, expect } from "vitest"
import { readCounterParams, writeCounterParams } from "@/lib/counter/url-state"

const TODAY = new Date(2026, 7, 24)

describe("readCounterParams", () => {
  it("defaults to yesterday and prior-period when nothing is set", () => {
    // Yesterday, not today: an owner opening the dashboard in the morning
    // wants the day that finished, not the one that has barely started.
    const p = readCounterParams(new URLSearchParams(), TODAY)
    expect(p.presetId).toBe("yesterday")
    expect(p.comparisonId).toBe("prev")
    expect(p.storeId).toBeNull()
  })

  it("reads a preset, a comparison and a store", () => {
    const p = readCounterParams(
      new URLSearchParams("range=d30&cmp=year&store=hollywood"),
      TODAY,
    )
    expect(p.presetId).toBe("d30")
    expect(p.comparisonId).toBe("year")
    expect(p.storeId).toBe("hollywood")
  })

  it("resolves the preset to a real range", () => {
    const p = readCounterParams(new URLSearchParams("range=d7"), TODAY)
    expect(p.range.end).toEqual(TODAY)
    expect(p.range.start).toEqual(new Date(2026, 7, 18))
  })

  it("falls back to the default on an unknown preset rather than throwing", () => {
    // A URL is user input. A hand-edited or stale param must not crash a page.
    const p = readCounterParams(new URLSearchParams("range=nonsense"), TODAY)
    expect(p.presetId).toBe("yesterday")
  })

  it("falls back on an unknown comparison too", () => {
    expect(readCounterParams(new URLSearchParams("cmp=sideways"), TODAY).comparisonId).toBe("prev")
  })

  it("drops the weekday comparison when the range is too long for it to mean anything", () => {
    // comparisonRange returns null past 7 days, so offering it would render an
    // empty comparison. Reading it back as "prev" keeps the page coherent.
    const p = readCounterParams(new URLSearchParams("range=d30&cmp=weekday"), TODAY)
    expect(p.comparisonId).toBe("prev")
  })

  it("keeps the weekday comparison when the range is short enough", () => {
    expect(readCounterParams(new URLSearchParams("range=d7&cmp=weekday"), TODAY).comparisonId)
      .toBe("weekday")
  })
})

describe("writeCounterParams", () => {
  it("sets what changed and leaves the rest alone", () => {
    const next = writeCounterParams(new URLSearchParams("range=d7&other=keep"), { presetId: "d30" })
    expect(next.get("range")).toBe("d30")
    expect(next.get("other")).toBe("keep")
  })

  it("removes a param set back to its default, so URLs stay short", () => {
    const next = writeCounterParams(new URLSearchParams("range=d30"), { presetId: "yesterday" })
    expect(next.get("range")).toBeNull()
  })

  it("clears the store when set to null — 'all stores' is the absence of a store", () => {
    const next = writeCounterParams(new URLSearchParams("store=hollywood"), { storeId: null })
    expect(next.get("store")).toBeNull()
  })
})
