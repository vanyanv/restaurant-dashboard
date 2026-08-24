import { describe, it, expect } from "vitest"
import {
  PRESETS, COMPARISONS, resolvePreset, bucketFor, stepRange, comparisonRange, dayCount,
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

  it("last year is the same dates a year earlier", () => {
    const c = comparisonRange(week, "year")!
    expect(c.start).toEqual(new Date(2025, 7, 18))
    expect(c.end).toEqual(new Date(2025, 7, 24))
  })

  it("same weekdays walks back four weeks for a single day", () => {
    const c = comparisonRange({ start: TODAY, end: TODAY }, "weekday")!
    expect(c.start).toEqual(new Date(2026, 6, 27)) // 4 Mondays earlier
    expect(c.end).toEqual(new Date(2026, 7, 17))   // the most recent prior Monday
  })

  it("none returns null, so a caller must handle 'no comparison' explicitly", () => {
    expect(comparisonRange(week, "none")).toBeNull()
  })
})
