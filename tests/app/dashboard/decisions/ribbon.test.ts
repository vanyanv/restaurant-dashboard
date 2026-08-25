// The ribbon's whole claim is that the column and its whisker are drawn on one
// axis, so a tall band reads as genuine uncertainty rather than decoration. The
// component can't assert that — it only interpolates percentages into styles —
// so the arithmetic lives here and is pinned.

import { describe, it, expect } from "vitest"
import { computeRibbon, type RibbonDay } from "@/app/dashboard/(editorial)/decisions/lib/ribbon"

const day = (over: Partial<RibbonDay> = {}): RibbonDay => ({
  date: "2026-08-18",
  predictedRevenue: 5000,
  p10: 4500,
  p90: 5500,
  labor: { status: "level", unfilledSlots: 0 },
  weatherTone: null,
  weatherHighC: null,
  weatherLowC: null,
  hasAnomaly: false,
  topEventTitle: null,
  majorEventCount: 0,
  ...over,
})

describe("computeRibbon — scale", () => {
  it("puts the top of the track at the highest p90, not the highest forecast", () => {
    const r = computeRibbon([
      day({ date: "a", predictedRevenue: 5000, p10: 4500, p90: 5500 }),
      day({ date: "b", predictedRevenue: 9000, p10: 8000, p90: 12000 }),
    ])
    expect(r.scaleMax).toBe(12000)
    expect(r.cells[1].barPct).toBeCloseTo(75, 5)
  })

  it("falls back to the forecast when a day carries no band", () => {
    const r = computeRibbon([day({ predictedRevenue: 8000, p10: null, p90: null })])
    expect(r.scaleMax).toBe(8000)
  })

  it("keeps a tiny day visible rather than drawing a hairline", () => {
    const r = computeRibbon([
      day({ date: "a", predictedRevenue: 20000, p10: null, p90: null }),
      day({ date: "b", predictedRevenue: 1, p10: null, p90: null }),
    ])
    expect(r.cells[1].barPct).toBe(2)
  })

  it("returns an empty ribbon for an empty week", () => {
    expect(computeRibbon([])).toEqual({ scaleMax: 0, cells: [] })
  })

  it("survives a week with no forecast at all", () => {
    const r = computeRibbon([day({ predictedRevenue: 0, p10: null, p90: null })])
    expect(r.scaleMax).toBe(0)
    expect(r.cells[0].barPct).toBe(0)
    expect(r.cells[0].isPeak).toBe(false)
  })
})

describe("computeRibbon — the whisker shares the column's axis", () => {
  // The invariant, stated in pixels: the whisker's caps must land at the same
  // heights p10 and p90 would if they were columns of their own.
  it("puts the caps exactly where p10 and p90 would draw", () => {
    const TRACK = 62
    const d = day({ predictedRevenue: 9240, p10: 7800, p90: 10800 })
    const r = computeRibbon([d])
    const cell = r.cells[0]
    const w = cell.whisker!

    const columnPx = (cell.barPct / 100) * TRACK
    const capTopPx = columnPx + (-w.topPct / 100) * columnPx
    const capBottomPx = capTopPx - (w.heightPct / 100) * columnPx

    expect(capTopPx).toBeCloseTo((d.p90! / r.scaleMax) * TRACK, 6)
    expect(capBottomPx).toBeCloseTo((d.p10! / r.scaleMax) * TRACK, 6)
  })

  it("lands the tallest upper cap exactly on the top of the track", () => {
    const r = computeRibbon([day({ predictedRevenue: 9240, p10: 7800, p90: 10800 })])
    const { barPct } = r.cells[0]
    const { topPct } = r.cells[0].whisker!
    expect(barPct + barPct * (-topPct / 100)).toBeCloseTo(100, 6)
  })

  it("withholds the whisker when either bound is missing", () => {
    expect(computeRibbon([day({ p10: null })]).cells[0].whisker).toBeNull()
    expect(computeRibbon([day({ p90: null })]).cells[0].whisker).toBeNull()
  })

  it("withholds a collapsed band rather than drawing a zero-height whisker", () => {
    expect(computeRibbon([day({ p10: 5000, p90: 5000 })]).cells[0].whisker).toBeNull()
  })

  it("withholds the whisker when there is no column to hang it on", () => {
    expect(
      computeRibbon([day({ predictedRevenue: 0, p10: 100, p90: 200 })]).cells[0].whisker,
    ).toBeNull()
  })
})

describe("computeRibbon — the peak", () => {
  it("marks exactly one day, the biggest", () => {
    const r = computeRibbon([
      day({ date: "a", predictedRevenue: 5000 }),
      day({ date: "b", predictedRevenue: 9000 }),
      day({ date: "c", predictedRevenue: 7000 }),
    ])
    expect(r.cells.map((c) => c.isPeak)).toEqual([false, true, false])
  })

  it("gives a tie to the earlier day rather than lighting two", () => {
    const r = computeRibbon([
      day({ date: "a", predictedRevenue: 9000 }),
      day({ date: "b", predictedRevenue: 9000 }),
    ])
    expect(r.cells.filter((c) => c.isPeak)).toHaveLength(1)
    expect(r.cells[0].isPeak).toBe(true)
  })
})

describe("computeRibbon — signals", () => {
  it("names the signals it has, in reading order", () => {
    const r = computeRibbon([
      day({
        topEventTitle: "Bowl show",
        majorEventCount: 2,
        weatherTone: "rain",
        hasAnomaly: true,
      }),
    ])
    expect(r.cells[0].signals.map((s) => s.label)).toEqual(["EVENT", "RAIN", "FLAG"])
  })

  it("reads heavy rain as rain", () => {
    const r = computeRibbon([day({ weatherTone: "heavy_rain" })])
    expect(r.cells[0].signals.map((s) => s.label)).toEqual(["RAIN"])
  })

  it("says nothing about a clear day", () => {
    expect(computeRibbon([day({ weatherTone: "clear" })]).cells[0].signals).toEqual([])
  })

  it("counts unfilled slots into the chip", () => {
    const r = computeRibbon([day({ labor: { status: "level", unfilledSlots: 2 } })])
    expect(r.cells[0].signals.map((s) => s.label)).toEqual(["2 OPEN"])
  })
})

describe("computeRibbon — red is earned", () => {
  it("reddens the peak day's signals when it is short of hours", () => {
    const r = computeRibbon([
      day({ date: "a", predictedRevenue: 5000, weatherTone: "rain" }),
      day({
        date: "b",
        predictedRevenue: 9000,
        topEventTitle: "Bowl show",
        majorEventCount: 1,
        labor: { status: "short", unfilledSlots: 0 },
      }),
    ])
    expect(r.cells[0].signals[0].hot).toBe(false)
    expect(r.cells[1].signals[0].hot).toBe(true)
  })

  it("leaves a short day alone when it is not the peak", () => {
    const r = computeRibbon([
      day({
        date: "a",
        predictedRevenue: 5000,
        topEventTitle: "Bowl show",
        majorEventCount: 1,
        labor: { status: "short", unfilledSlots: 0 },
      }),
      day({ date: "b", predictedRevenue: 9000 }),
    ])
    expect(r.cells[0].signals[0].hot).toBe(false)
  })

  it("leaves the peak alone when the schedule covers it", () => {
    const r = computeRibbon([
      day({ predictedRevenue: 9000, topEventTitle: "Bowl show", majorEventCount: 1 }),
    ])
    expect(r.cells[0].isPeak).toBe(true)
    expect(r.cells[0].signals[0].hot).toBe(false)
  })

  it("always reddens unfilled slots, wherever they land", () => {
    const r = computeRibbon([
      day({ date: "a", predictedRevenue: 5000, labor: { status: "level", unfilledSlots: 1 } }),
      day({ date: "b", predictedRevenue: 9000 }),
    ])
    expect(r.cells[0].isPeak).toBe(false)
    expect(r.cells[0].signals[0]).toEqual({ label: "1 OPEN", hot: true })
  })

  it("never reddens more than one day's weather or events", () => {
    const week = ["a", "b", "c", "d", "e", "f", "g"].map((date, i) =>
      day({
        date,
        predictedRevenue: 1000 * (i + 1),
        weatherTone: "rain",
        labor: { status: "short", unfilledSlots: 0 },
      }),
    )
    const hotDays = computeRibbon(week).cells.filter((c) =>
      c.signals.some((s) => s.hot),
    )
    expect(hotDays).toHaveLength(1)
  })
})

// The live page on 2026-08-20 printed EVENT on six of seven days and HOT on all
// seven, because "is there an event title" and "is it over 32°C" are both true
// almost every August day in Los Angeles. Fourteen identical chips carry no
// information. A chip has to mean "this day is not like the others".
describe("computeRibbon — a chip has to be news", () => {
  const hotDay = (date: string, highC: number, over: Partial<RibbonDay> = {}) =>
    day({ date, weatherTone: "heat", weatherHighC: highC, ...over })

  it("ignores an event title with no major event behind it", () => {
    const r = computeRibbon([day({ topEventTitle: "Farmers market", majorEventCount: 0 })])
    expect(r.cells[0].signals).toEqual([])
  })

  it("chips an event the provider ranked major", () => {
    const r = computeRibbon([day({ topEventTitle: "Bowl show", majorEventCount: 1 })])
    expect(r.cells[0].signals.map((s) => s.label)).toEqual(["EVENT"])
  })

  it("gives HOT to one day a week, not seven", () => {
    const week = [
      hotDay("a", 33), hotDay("b", 34), hotDay("c", 35),
      hotDay("d", 38), hotDay("e", 34), hotDay("f", 33), hotDay("g", 32),
    ]
    const cells = computeRibbon(week).cells
    expect(cells.filter((c) => c.signals.some((s) => s.label === "HOT"))).toHaveLength(1)
    expect(cells[3].signals.map((s) => s.label)).toEqual(["HOT"])
  })

  it("gives COLD to the coldest day only", () => {
    const week = [
      day({ date: "a", weatherTone: "cold", weatherLowC: 1 }),
      day({ date: "b", weatherTone: "cold", weatherLowC: -4 }),
      day({ date: "c", weatherTone: "cold", weatherLowC: 2 }),
    ]
    const cells = computeRibbon(week).cells
    expect(cells.map((c) => c.signals.map((s) => s.label).join(""))).toEqual(["", "COLD", ""])
  })

  it("still chips every rainy day — rain is episodic, not relative", () => {
    const week = [
      day({ date: "a", weatherTone: "rain" }),
      day({ date: "b", weatherTone: "heavy_rain" }),
      day({ date: "c", weatherTone: "clear" }),
    ]
    expect(computeRibbon(week).cells.map((c) => c.signals.length)).toEqual([1, 1, 0])
  })

  it("never suppresses an anomaly or an unfilled shift", () => {
    const r = computeRibbon([
      day({ date: "a", hasAnomaly: true, labor: { status: "level", unfilledSlots: 3 } }),
      day({ date: "b", hasAnomaly: true }),
    ])
    expect(r.cells[0].signals.map((s) => s.label)).toEqual(["FLAG", "3 OPEN"])
    expect(r.cells[1].signals.map((s) => s.label)).toEqual(["FLAG"])
  })

  it("holds the whole week under six chips on the shape that broke it", () => {
    // Six days with an event title and no major count, all of them hot.
    const week = ["a", "b", "c", "d", "e", "f", "g"].map((date, i) =>
      hotDay(date, 33 + (i === 5 ? 4 : 0), {
        predictedRevenue: 6000 + i * 100,
        topEventTitle: i === 6 ? null : "Something nearby",
        majorEventCount: i === 5 ? 2 : 0,
      }),
    )
    const total = computeRibbon(week).cells.reduce((n, c) => n + c.signals.length, 0)
    expect(total).toBeLessThanOrEqual(5)
  })

  it("says nothing at all about a day with no weather reading", () => {
    expect(computeRibbon([day({ weatherTone: "heat", weatherHighC: null })]).cells[0].signals)
      .toEqual([])
  })
})
