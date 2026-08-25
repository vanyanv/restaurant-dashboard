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

const TODAY_CUSTOM = new Date(2026, 7, 25) // Tue 25 Aug 2026

describe("custom ranges in the URL", () => {
  it("reads from/to as a custom range", () => {
    const p = readCounterParams(new URLSearchParams("from=2026-08-03&to=2026-08-09"), TODAY_CUSTOM)
    expect(p.presetId).toBe("custom")
    expect(p.range).toEqual({ start: new Date(2026, 7, 3), end: new Date(2026, 7, 9) })
  })

  it("ignores a custom range that is missing an end", () => {
    const p = readCounterParams(new URLSearchParams("from=2026-08-03"), TODAY_CUSTOM)
    expect(p.presetId).toBe("yesterday")
  })

  it("ignores a backwards custom range rather than rendering it", () => {
    const p = readCounterParams(new URLSearchParams("from=2026-08-09&to=2026-08-03"), TODAY_CUSTOM)
    expect(p.presetId).toBe("yesterday")
  })

  it("ignores an unparseable custom range", () => {
    const p = readCounterParams(new URLSearchParams("from=last-tuesday&to=2026-08-09"), TODAY_CUSTOM)
    expect(p.presetId).toBe("yesterday")
  })

  it("lets from/to win over a named range, because it is the more specific one", () => {
    const p = readCounterParams(new URLSearchParams("range=d30&from=2026-08-03&to=2026-08-09"), TODAY_CUSTOM)
    expect(p.presetId).toBe("custom")
  })

  it("writes a custom range and drops the named one", () => {
    const out = writeCounterParams(new URLSearchParams("range=d30&store=s1"), {
      range: { start: new Date(2026, 7, 3), end: new Date(2026, 7, 9) },
    })
    expect(out.get("from")).toBe("2026-08-03")
    expect(out.get("to")).toBe("2026-08-09")
    expect(out.get("range")).toBeNull()
    expect(out.get("store")).toBe("s1")
  })

  it("clears a custom range when a preset is chosen", () => {
    const out = writeCounterParams(new URLSearchParams("from=2026-08-03&to=2026-08-09"), {
      presetId: "d7",
    })
    expect(out.get("range")).toBe("d7")
    expect(out.get("from")).toBeNull()
    expect(out.get("to")).toBeNull()
  })

  it("clears a custom range when passed null", () => {
    const out = writeCounterParams(new URLSearchParams("from=2026-08-03&to=2026-08-09"), {
      range: null,
    })
    expect(out.get("from")).toBeNull()
    expect(out.get("to")).toBeNull()
  })

  it("round-trips: what write produces, read understands", () => {
    const range = { start: new Date(2026, 7, 3), end: new Date(2026, 7, 9) }
    const out = writeCounterParams(new URLSearchParams(), { range })
    expect(readCounterParams(new URLSearchParams(out.toString()), TODAY_CUSTOM).range).toEqual(range)
  })

  it("still drops the weekday comparison on a custom range longer than a week", () => {
    const p = readCounterParams(
      new URLSearchParams("from=2026-07-01&to=2026-08-09&cmp=weekday"),
      TODAY_CUSTOM,
    )
    expect(p.comparisonId).toBe("prev")
  })
})
