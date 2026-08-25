import { describe, it, expect } from "vitest"
import {
  PRESETS, COMPARISONS, resolvePreset, bucketFor, stepRange, comparisonRange, dayCount,
  toQueryBounds, isoDay, parseIsoDay, rangeLabel,
} from "@/lib/counter/date-range"

const TODAY = new Date(2026, 7, 24) // Mon 24 Aug 2026, local midnight

describe("presets", () => {
  it("offers exactly the twelve the design specifies", () => {
    expect(PRESETS).toHaveLength(12)
    expect(PRESETS.map((p) => p.id)).toEqual([
      "today", "yesterday", "wtd", "lastweek",
      "d3", "d7", "d14", "d30", "d90",
      "mtd", "qtd", "ytd",
    ])
  })

  it("today is a single day", () => {
    const r = resolvePreset("today", TODAY)
    expect(r).toEqual({ start: TODAY, end: TODAY })
    expect(dayCount(r)).toBe(1)
  })

  it("last 7 days includes today, so it is 7 days not 8", () => {
    expect(dayCount(resolvePreset("d7", TODAY))).toBe(7)
  })

  it("this week runs Monday to today", () => {
    const r = resolvePreset("wtd", TODAY)
    expect(r.start).toEqual(new Date(2026, 7, 24)) // Monday IS today here
    expect(r.end).toEqual(TODAY)
  })

  it("last week is the seven whole days before this week began", () => {
    const r = resolvePreset("lastweek", TODAY)
    expect(dayCount(r)).toBe(7)
    expect(r.end).toEqual(new Date(2026, 7, 23)) // Sunday
  })

  it("month-to-date starts on the first", () => {
    expect(resolvePreset("mtd", TODAY).start).toEqual(new Date(2026, 7, 1))
  })

  it("quarter-to-date starts at the quarter boundary", () => {
    expect(resolvePreset("qtd", TODAY).start).toEqual(new Date(2026, 6, 1))
  })

  it("year-to-date starts on 1 January", () => {
    expect(resolvePreset("ytd", TODAY).start).toEqual(new Date(2026, 0, 1))
  })

  it("normalises a mid-afternoon `today` to local midnight before resolving, for every preset (2c)", () => {
    // The module's own contract: "all dates are local midnights." A caller
    // passes `new Date()`, whatever time of day it is constructed — verified
    // that `d7` at 14:32 used to return `Tue 14:32 .. Mon 14:32` instead of
    // two midnights, silently dropping the rest of today from any query
    // using `end` as an inclusive bound.
    const midAfternoon = new Date(2026, 7, 24, 14, 32, 10, 500)
    for (const p of PRESETS) {
      const r = resolvePreset(p.id, midAfternoon)
      expect(r.start.getHours()).toBe(0)
      expect(r.start.getMinutes()).toBe(0)
      expect(r.start.getSeconds()).toBe(0)
      expect(r.start.getMilliseconds()).toBe(0)
      expect(r.end.getHours()).toBe(0)
      expect(r.end.getMinutes()).toBe(0)
      expect(r.end.getSeconds()).toBe(0)
      expect(r.end.getMilliseconds()).toBe(0)
    }
  })
})

describe("bucketFor", () => {
  it("uses days up to a month", () => {
    expect(bucketFor({ start: new Date(2026, 7, 1), end: new Date(2026, 7, 24) })).toBe("day")
  })

  it("uses weeks up to four months", () => {
    expect(bucketFor({ start: new Date(2026, 4, 1), end: new Date(2026, 7, 24) })).toBe("week")
  })

  it("uses months beyond four", () => {
    expect(bucketFor({ start: new Date(2025, 7, 1), end: new Date(2026, 7, 24) })).toBe("month")
  })
})

describe("stepRange", () => {
  it("walks back by exactly the span you are on, not by a calendar unit", () => {
    const week = { start: new Date(2026, 7, 18), end: new Date(2026, 7, 24) }
    const back = stepRange(week, -1)
    expect(dayCount(back)).toBe(7)
    expect(back.end).toEqual(new Date(2026, 7, 17))
    expect(back.start).toEqual(new Date(2026, 7, 11))
  })

  it("steps forward the same way", () => {
    const day = { start: TODAY, end: TODAY }
    expect(stepRange(day, 1)).toEqual({
      start: new Date(2026, 7, 25), end: new Date(2026, 7, 25),
    })
  })
})

describe("comparisonRange", () => {
  const week = { start: new Date(2026, 7, 18), end: new Date(2026, 7, 24) }

  it("offers exactly four modes", () => {
    expect(COMPARISONS.map((c) => c.id)).toEqual(["prev", "weekday", "year", "none"])
  })

  it("prior period is the same length immediately before", () => {
    const c = comparisonRange(week, "prev")!
    expect(dayCount(c)).toBe(7)
    expect(c.end).toEqual(new Date(2026, 7, 17))
  })

  it("last year is 364 days earlier (52 weeks), not the same calendar date", () => {
    // R4: NOT `subYears` — that lands on the same calendar date, which is a
    // shifted weekday most years. A 364-day offset preserves it instead.
    const c = comparisonRange(week, "year")!
    expect(c.start).toEqual(new Date(2025, 7, 19))
    expect(c.end).toEqual(new Date(2025, 7, 25))
  })

  it("last year preserves the weekday of every day in the range — a restaurant's week has a strong shape", () => {
    // Tue 18 Aug .. Mon 24 Aug 2026 — a subYears offset would land on
    // Mon 18 Aug .. Sun 24 Aug 2025, comparing a Mon–Sun week against Sun–Sat.
    const c = comparisonRange(week, "year")!
    expect(week.start.getDay()).toBe(c.start.getDay())
    expect(week.end.getDay()).toBe(c.end.getDay())
  })

  it("same weekdays walks back four weeks for a single day", () => {
    const c = comparisonRange({ start: TODAY, end: TODAY }, "weekday")!
    expect(c.start).toEqual(new Date(2026, 6, 27)) // 4 Mondays earlier
    expect(c.end).toEqual(new Date(2026, 7, 17))   // the most recent prior Monday
  })

  it("same weekdays covers the four preceding weeks for a 7-day range", () => {
    const c = comparisonRange(week, "weekday")!
    expect(c.start).toEqual(new Date(2026, 6, 21)) // Tue 21 Jul
    expect(c.end).toEqual(new Date(2026, 7, 17))   // Mon 17 Aug
    expect(dayCount(c)).toBe(28)
  })

  it("same weekdays has no meaning past a week, so it is null for a 30-day range", () => {
    const month = { start: new Date(2026, 6, 26), end: new Date(2026, 7, 24) }
    expect(comparisonRange(month, "weekday")).toBeNull()
  })

  it("same weekdays is null one day past the boundary, not silently wrong", () => {
    const eightDays = { start: new Date(2026, 7, 17), end: new Date(2026, 7, 24) }
    expect(dayCount(eightDays)).toBe(8)
    expect(comparisonRange(eightDays, "weekday")).toBeNull()
  })

  it("none returns null, so a caller must handle 'no comparison' explicitly", () => {
    expect(comparisonRange(week, "none")).toBeNull()
  })
})

describe("toQueryBounds", () => {
  it("converts Counter's {start, end} midnights into the inclusive-end {startDate, endDate} existing queries expect", () => {
    const r = { start: new Date(2026, 7, 18), end: new Date(2026, 7, 24) }
    const b = toQueryBounds(r)
    expect(b.startDate).toEqual(r.start)
    expect(b.endDate).toEqual(new Date(2026, 7, 24, 23, 59, 59))
  })

  it("a single-day range still covers the whole day, not zero seconds of it", () => {
    const day = { start: TODAY, end: TODAY }
    const b = toQueryBounds(day)
    expect(b.startDate).toEqual(new Date(2026, 7, 24, 0, 0, 0))
    expect(b.endDate).toEqual(new Date(2026, 7, 24, 23, 59, 59))
  })
})

describe("isoDay / parseIsoDay", () => {
  it("round-trips a local date without a UTC shift", () => {
    // 2026-01-01 at 00:30 local. toISOString() on this in any timezone west
    // of UTC returns the PREVIOUS day — which is exactly the bug this pair
    // exists to avoid.
    const d = new Date(2026, 0, 1, 0, 30)
    expect(isoDay(d)).toBe("2026-01-01")
    expect(parseIsoDay(isoDay(d))).toEqual(new Date(2026, 0, 1))
  })

  it("pads single-digit months and days", () => {
    expect(isoDay(new Date(2026, 8, 5))).toBe("2026-09-05")
  })

  it("returns null for anything that is not a calendar date", () => {
    for (const bad of ["", "nope", "2026-13-01", "2026-02-30", "2026-2-1", "2026-01-01T00:00:00Z"]) {
      expect(parseIsoDay(bad)).toBeNull()
    }
  })

  it("returns a local midnight, not a UTC one", () => {
    const d = parseIsoDay("2026-08-25")!
    expect(d.getHours()).toBe(0)
    expect(d.getDate()).toBe(25)
  })
})

describe("rangeLabel", () => {
  it("names a preset by its own name", () => {
    expect(rangeLabel({ start: new Date(2026, 7, 24), end: new Date(2026, 7, 24) }, "yesterday"))
      .toBe("Yesterday")
  })

  it("names a custom multi-day window by its ends", () => {
    expect(rangeLabel({ start: new Date(2026, 7, 3), end: new Date(2026, 7, 9) }, "custom"))
      .toBe("Aug 3 – Aug 9")
  })

  it("names a custom single day once, not twice", () => {
    expect(rangeLabel({ start: new Date(2026, 7, 3), end: new Date(2026, 7, 3) }, "custom"))
      .toBe("Aug 3")
  })

  it("spans a year boundary without dropping the year", () => {
    expect(rangeLabel({ start: new Date(2025, 11, 29), end: new Date(2026, 0, 4) }, "custom"))
      .toBe("Dec 29, 2025 – Jan 4, 2026")
  })
})
