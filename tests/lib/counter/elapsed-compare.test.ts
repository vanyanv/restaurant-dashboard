import { describe, expect, it } from "vitest"
import {
  buildElapsedCompare,
  elapsedWithoutReads,
  hourWords,
  lastDayState,
  laClock,
  mayBeIncomplete,
  type HourlyRow,
} from "@/lib/counter/elapsed-compare"

/**
 * The auditor's morning: "Every store sold less: Glendale -56%". A day still
 * trading or still syncing was read against the same weekday last week in
 * full. These pin the rule that decides a day is unfinished, and the
 * hour-for-hour comparison that replaces the full-day one while it is.
 *
 * 2026-11-18 is a Wednesday; 11-11 the Wednesday before; 11-17 a Tuesday.
 */
const WED = new Date(2026, 10, 18)
const TUE = new Date(2026, 10, 17)
const one = (d: Date) => ({ start: d, end: d })

/** Hourly rows for one store and day, $100 an hour over the given hours. */
const hours = (storeId: string, day: string, from: number, to: number, each = 100): HourlyRow[] =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ storeId, day, hour: from + i, netSales: each }))

describe("laClock", () => {
  it("reads an instant's Los Angeles day and hour", () => {
    expect(laClock(new Date("2026-11-18T01:30:00-08:00"))).toEqual({ day: "2026-11-18", hour: 1 })
    expect(laClock(new Date("2026-11-18T23:10:00-08:00"))).toEqual({ day: "2026-11-18", hour: 23 })
  })

  it("words an hour", () => {
    expect([hourWords(0), hourWords(11), hourWords(12), hourWords(23), hourWords(24)]).toEqual([
      "midnight", "11 am", "noon", "11 pm", "midnight",
    ])
  })
})

describe("lastDayState", () => {
  it("never calls today complete, however fresh the sync", () => {
    const now = new Date("2026-11-18T11:20:00-08:00")
    expect(lastDayState({ range: one(WED), now, lastSyncAt: now, newestHourly: { day: "2026-11-18", hour: 11 } })).toBe("today")
  })

  it("treats a range that runs past today as ending today", () => {
    const now = new Date("2026-11-18T11:20:00-08:00")
    const range = { start: new Date(2026, 10, 1), end: new Date(2026, 10, 30) }
    expect(lastDayState({ range, now, lastSyncAt: now, newestHourly: null })).toBe("today")
  })

  it("calls yesterday still syncing until a sync has run past 03:00 the morning after", () => {
    const now = new Date("2026-11-18T01:30:00-08:00")
    expect(
      lastDayState({ range: one(TUE), now, lastSyncAt: new Date("2026-11-17T22:05:00-08:00"), newestHourly: null }),
    ).toBe("syncing")
    // A run at 02:00 has not seen a 1-2am close settle.
    expect(
      lastDayState({ range: one(TUE), now, lastSyncAt: new Date("2026-11-18T02:00:00-08:00"), newestHourly: null }),
    ).toBe("syncing")
  })

  it("calls yesterday complete once a successful sync ran at or after 03:00", () => {
    const now = new Date("2026-11-18T09:00:00-08:00")
    expect(
      lastDayState({ range: one(TUE), now, lastSyncAt: new Date("2026-11-18T04:00:00-08:00"), newestHourly: null }),
    ).toBe("complete")
  })

  it("falls back to the newest hourly row when no sync run is on file", () => {
    const now = new Date("2026-11-18T09:00:00-08:00")
    const at = (day: string, hour: number) => lastDayState({ range: one(TUE), now, lastSyncAt: null, newestHourly: { day, hour } })
    expect(at("2026-11-17", 23)).toBe("syncing")
    expect(at("2026-11-18", 1)).toBe("syncing")
    expect(at("2026-11-18", 8)).toBe("complete")
  })

  it("keeps the full comparison when nothing on file says a past day is unfinished", () => {
    const now = new Date("2026-11-18T09:00:00-08:00")
    expect(lastDayState({ range: one(TUE), now, lastSyncAt: null, newestHourly: null })).toBe("complete")
  })

  it("does not read at all for a range that ended days ago", () => {
    const now = new Date("2026-11-18T09:00:00-08:00")
    expect(mayBeIncomplete(one(new Date(2026, 10, 10)), now)).toBe(false)
    expect(mayBeIncomplete(one(TUE), now)).toBe(true)
    expect(mayBeIncomplete(one(WED), now)).toBe(true)
  })
})

describe("buildElapsedCompare", () => {
  it("today: compares through the last whole synced hour against the same hours last week", () => {
    const now = new Date("2026-11-18T11:20:00-08:00")
    const rows = [
      // Today: 8am-11am, the 11 o'clock hour still in progress.
      ...hours("h", "2026-11-18", 8, 11),
      ...hours("g", "2026-11-18", 8, 10, 50),
      // Last Wednesday in full: the hours after 11 must not count.
      ...hours("h", "2026-11-11", 8, 23, 90),
      ...hours("g", "2026-11-11", 8, 23, 100),
    ]
    const e = buildElapsedCompare({ range: one(WED), state: "today", now, rows, newestHourly: { day: "2026-11-18", hour: 11 } })
    expect(e.throughHour).toBe(11)
    expect(e.current).toBe(300 + 150)
    expect(e.prior).toBe(270 + 300)
    expect(e.perStore).toEqual({ h: { current: 300, prior: 270 }, g: { current: 150, prior: 300 } })
    expect(e.label).toBe("the same time last Wednesday")
    expect(e.against).toBe("so far today (through 11 am), vs the same time last Wednesday")
  })

  it("yesterday still syncing: cuts both days at the last synced hour and says so", () => {
    const now = new Date("2026-11-18T01:30:00-08:00")
    const rows = [...hours("h", "2026-11-17", 11, 22), ...hours("h", "2026-11-10", 11, 23)]
    const e = buildElapsedCompare({ range: one(TUE), state: "syncing", now, rows, newestHourly: { day: "2026-11-17", hour: 22 } })
    expect(e.throughHour).toBe(23)
    expect(e.current).toBe(1200)
    expect(e.prior).toBe(1200)
    expect(e.against).toBe("Yesterday is still syncing (through 11 pm): vs the same hours last Tuesday")
  })

  it("yesterday syncing with the hourly feed already past it: compares the whole day hour for hour", () => {
    const now = new Date("2026-11-18T02:30:00-08:00")
    const rows = [...hours("h", "2026-11-17", 11, 23), ...hours("h", "2026-11-10", 11, 23)]
    const e = buildElapsedCompare({ range: one(TUE), state: "syncing", now, rows, newestHourly: { day: "2026-11-18", hour: 1 } })
    expect(e.throughHour).toBe(24)
    expect(e.current).toBe(e.prior)
  })

  it("missing hourly data on either side: no figures, and says the comparison waits", () => {
    const now = new Date("2026-11-18T11:20:00-08:00")
    const noToday = buildElapsedCompare({
      range: one(WED), state: "today", now, rows: hours("h", "2026-11-11", 8, 23), newestHourly: { day: "2026-11-17", hour: 23 },
    })
    expect(noToday).toMatchObject({ current: null, prior: null, throughHour: null, perStore: {} })
    expect(noToday.note).toBe("Today is still trading, so the comparison with the period before waits until the day is complete.")

    const noPrior = buildElapsedCompare({
      range: one(TUE), state: "syncing", now: new Date("2026-11-18T01:30:00-08:00"),
      rows: hours("h", "2026-11-17", 11, 22), newestHourly: { day: "2026-11-17", hour: 22 },
    })
    expect(noPrior.current).toBeNull()
    expect(noPrior.note).toBe("Yesterday is still syncing, so the comparison with the period before waits until the day is complete.")
  })

  it("a multi-day range counts its earlier days in full and cuts only the last", () => {
    const now = new Date("2026-11-18T11:20:00-08:00")
    const range = { start: new Date(2026, 10, 16), end: WED }
    const rows = [
      ...hours("h", "2026-11-16", 11, 23), ...hours("h", "2026-11-17", 11, 23), ...hours("h", "2026-11-18", 9, 11),
      ...hours("h", "2026-11-09", 11, 23), ...hours("h", "2026-11-10", 11, 23), ...hours("h", "2026-11-11", 9, 23),
    ]
    const e = buildElapsedCompare({ range, state: "today", now, rows, newestHourly: { day: "2026-11-18", hour: 11 } })
    expect(e.current).toBe(2600 + 200)
    expect(e.prior).toBe(2600 + 200)
    expect(e.label).toBe("the same time of Nov 9 – Nov 11")
  })
})

describe("elapsedWithoutReads", () => {
  it("drops the percent for today, and leaves a past day to compare in full", () => {
    const now = new Date("2026-11-18T11:20:00-08:00")
    expect(elapsedWithoutReads(one(WED), now)?.current).toBeNull()
    expect(elapsedWithoutReads(one(TUE), now)).toBeNull()
  })
})
