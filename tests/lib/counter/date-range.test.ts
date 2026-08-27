import { describe, it, expect } from "vitest"
import {
  PRESETS, COMPARISONS, resolvePreset, bucketFor, stepRange, comparisonRange, dayCount,
  toQueryBounds, isoDay, parseIsoDay, rangeLabel, rangeTitle, rangeSubtitle,
  monthDay, trailingWeeks,
} from "@/lib/counter/date-range"
import { addDays as addDaysFor } from "date-fns"

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
  // Task 3c (A-R19): bounds are UTC-anchored, not local-time-anchored.
  // `r.start`/`r.end` are local midnights (this module's contract); the
  // bounds a query gets are the SAME CALENDAR DAY rebuilt as a UTC instant,
  // because every one of `toQueryBounds`'s six callers filters a `@db.Date`
  // column (UTC midnight) or `referenceTimeLocal` (local time encoded AS a
  // UTC epoch). Under TZ=UTC a local midnight and a UTC midnight are the same
  // instant, so this file's assertions used to hold there BY ACCIDENT — they
  // encoded `b.startDate` as `r.start` verbatim and `b.endDate` as local
  // 23:59:59, which is only correct off UTC if the reader ignores the offset
  // entirely. That was the bug (see tests/lib/counter/date-range-bounds.test.ts
  // for the fuller reproduction and the invariant this restores): a bound
  // still carrying a local-time offset, floored in UTC by `buildPeriods`,
  // produced one extra day of periods and one extra day of query rows.
  it("converts Counter's {start, end} midnights into the inclusive-end {startDate, endDate} existing queries expect, as UTC instants", () => {
    const r = { start: new Date(2026, 7, 18), end: new Date(2026, 7, 24) }
    const b = toQueryBounds(r)
    expect(b.startDate).toEqual(new Date(Date.UTC(2026, 7, 18, 0, 0, 0)))
    expect(b.endDate).toEqual(new Date(Date.UTC(2026, 7, 24, 23, 59, 59)))
  })

  it("a single-day range still covers the whole day, not zero seconds of it", () => {
    const day = { start: TODAY, end: TODAY }
    const b = toQueryBounds(day)
    expect(b.startDate).toEqual(new Date(Date.UTC(2026, 7, 24, 0, 0, 0)))
    expect(b.endDate).toEqual(new Date(Date.UTC(2026, 7, 24, 23, 59, 59)))
  })
})

describe("isoDay / parseIsoDay", () => {
  it("reads local calendar fields, not UTC ones", () => {
    // A `toISOString().slice(0, 10)` implementation shifts the date whenever
    // the local offset crosses a midnight: BACKWARDS east of UTC at early
    // times, FORWARDS west of UTC at late ones. Asserting one time of day
    // only catches one of those directions — and this repo's own machines sit
    // west of UTC, where the early-morning case agrees with UTC and proves
    // nothing. Both ends of the same local day is the assertion that holds in
    // every zone. (Under TZ=UTC the two implementations genuinely agree;
    // there is no bug to catch there.)
    const early = new Date(2026, 0, 1, 0, 30)
    const late = new Date(2026, 0, 1, 23, 59, 59, 999)
    expect(isoDay(early)).toBe("2026-01-01")
    expect(isoDay(late)).toBe("2026-01-01")
    expect(parseIsoDay(isoDay(late))).toEqual(new Date(2026, 0, 1))
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

describe("rangeTitle", () => {
  it("names a multi-day window by its span and where it ends", () => {
    expect(rangeTitle({ start: new Date(2026, 7, 15), end: new Date(2026, 7, 21) })).toBe(
      "7 days to Aug 21",
    )
  })

  it("names a single day by its weekday, because that is what makes it different", () => {
    // The prototype's `P.overview.title()`: "Tuesday's numbers". A restaurant's
    // week has a strong shape, so which weekday it is IS the context.
    expect(rangeTitle({ start: new Date(2026, 7, 25), end: new Date(2026, 7, 25) })).toBe(
      "Tuesday's numbers",
    )
  })

  it("never says the page's name — that is the breadcrumb's job", () => {
    const title = rangeTitle({ start: new Date(2026, 0, 1), end: new Date(2026, 7, 21) })
    expect(title).toBe("233 days to Aug 21")
  })
})

describe("rangeSubtitle", () => {
  it("is the store, the window and what it is measured against, in that order", () => {
    expect(
      rangeSubtitle("Hollywood", { start: new Date(2026, 7, 15), end: new Date(2026, 7, 21) }, "weekday"),
    ).toBe("Hollywood · Aug 15 – Aug 21 · vs the same 4 weekdays")
  })

  it("still names the comparison when it is switched off, rather than going silent", () => {
    // "with no comparison" is a fact a reader needs: a page showing no deltas
    // because none were asked for reads exactly like one showing no deltas
    // because they failed.
    expect(
      rangeSubtitle("All stores", { start: new Date(2026, 7, 21), end: new Date(2026, 7, 21) }, "none"),
    ).toBe("All stores · Aug 21 · with no comparison")
  })

  it("carries the year when the window straddles one, via rangeLabel", () => {
    expect(
      rangeSubtitle("Hollywood", { start: new Date(2025, 11, 29), end: new Date(2026, 0, 4) }, "prev"),
    ).toBe("Hollywood · Dec 29, 2025 – Jan 4, 2026 · vs the prior period")
  })

  /**
   * The P&L's fourth term. `P.pnl.sub()` (prototype line 5248) carries it and
   * `R.head()` — the Overview's — does not, so it is opt-in: a statement's
   * fixed lines are prorated across exactly that many days, and a reader
   * counting them off "Aug 15 – 21" is doing arithmetic the head could do.
   */
  it("carries the day count between the window and the comparison, when asked", () => {
    expect(
      rangeSubtitle(
        "Hollywood",
        { start: new Date(2026, 7, 15), end: new Date(2026, 7, 21) },
        "prev",
        { days: true },
      ),
    ).toBe("Hollywood · Aug 15 – Aug 21 · 7 days · vs the prior period")
  })

  it("says '1 day', not '1 days', on a single-day range", () => {
    expect(
      rangeSubtitle("All stores", { start: new Date(2026, 7, 21), end: new Date(2026, 7, 21) }, "none", {
        days: true,
      }),
    ).toBe("All stores · Aug 21 · 1 day · with no comparison")
  })

  it("adds nothing at all when it is not asked — the Overview's head is unchanged", () => {
    const r = { start: new Date(2026, 7, 15), end: new Date(2026, 7, 21) }
    expect(rangeSubtitle("Hollywood", r, "prev")).toBe(
      "Hollywood · Aug 15 – Aug 21 · vs the prior period",
    )
    expect(rangeSubtitle("Hollywood", r, "prev", {})).toBe(
      rangeSubtitle("Hollywood", r, "prev"),
    )
  })
})

describe("monthDay", () => {
  it("writes a date the way a week row heads itself — no year", () => {
    expect(monthDay(new Date(2026, 7, 3))).toBe("Aug 3")
    expect(monthDay(new Date(2025, 11, 29))).toBe("Dec 29")
  })
})

/**
 * Note 53's eight weeks. The anchoring is the whole test: every case below
 * passes NO range, because there is no range to pass — the list is a function
 * of today and nothing else.
 */
describe("trailingWeeks", () => {
  // Thu 20 Aug 2026. Its week starts Mon 17 Aug and has four days in it.
  const THU = new Date(2026, 7, 20)

  it("returns n windows, oldest first, each starting on a Monday", () => {
    const ws = trailingWeeks(THU, 8)
    expect(ws).toHaveLength(8)
    for (const w of ws) expect(w.start.getDay()).toBe(1)
    expect(isoDay(ws[0].start)).toBe("2026-06-29")
    expect(isoDay(ws[7].start)).toBe("2026-08-17")
  })

  it("steps exactly seven days between one window and the next", () => {
    const ws = trailingWeeks(THU, 8)
    for (let i = 1; i < ws.length; i += 1) {
      expect(dayCount({ start: ws[i - 1].start, end: ws[i].start })).toBe(8)
    }
  })

  it("draws every finished week as seven whole days", () => {
    const ws = trailingWeeks(THU, 8)
    for (const w of ws.slice(0, 7)) {
      expect(w.days).toBe(7)
      expect(w.partial).toBe(false)
      expect(isoDay(w.end)).toBe(isoDay(addDaysFor(w.start, 6)))
    }
  })

  it("clips the running week to today and says it is short", () => {
    const last = trailingWeeks(THU, 8)[7]
    expect(isoDay(last.start)).toBe("2026-08-17")
    expect(isoDay(last.end)).toBe("2026-08-20")
    expect(last.days).toBe(4)
    expect(last.partial).toBe(true)
  })

  it("does not call a week short on the day it finishes", () => {
    // Sun 23 Aug 2026 — the last day of its own week.
    const last = trailingWeeks(new Date(2026, 7, 23), 8)[7]
    expect(last.days).toBe(7)
    expect(last.partial).toBe(false)
    expect(isoDay(last.end)).toBe("2026-08-23")
  })

  it("draws a Monday as one day, not as a week that has not happened", () => {
    const last = trailingWeeks(new Date(2026, 7, 24), 8)[7]
    expect(isoDay(last.start)).toBe("2026-08-24")
    expect(isoDay(last.end)).toBe("2026-08-24")
    expect(last.days).toBe(1)
    expect(last.partial).toBe(true)
  })

  it("normalises a today carrying a time of day, so no window is 6 days 23 hours", () => {
    const ws = trailingWeeks(new Date(2026, 7, 20, 14, 32, 5), 8)
    expect(isoDay(ws[7].end)).toBe("2026-08-20")
    expect(ws[7].end.getHours()).toBe(0)
    expect(ws[0].start.getHours()).toBe(0)
    expect(ws[0].days).toBe(7)
  })

  it("crosses a year boundary without losing a week", () => {
    const ws = trailingWeeks(new Date(2026, 0, 7), 8)
    expect(isoDay(ws[0].start)).toBe("2025-11-17")
    expect(isoDay(ws[7].end)).toBe("2026-01-07")
  })

  it("returns nothing rather than a made-up week when asked for none", () => {
    expect(trailingWeeks(THU, 0)).toEqual([])
  })
})
