/**
 * serviceProfile / dayOfWeekProfile — the two PURE functions in
 * `src/lib/counter/service-profile.ts`. `loadServiceProfile` (the loader) is
 * not unit-tested, per BUILD VELOCITY mode: it is not money/share arithmetic
 * itself, only plumbing around it.
 *
 * The measured d7 hourly counts and the measured 90-day weekday averages come
 * from "The measured data" in the plan — quoted verbatim, not re-derived.
 */
import { describe, it, expect, vi } from "vitest"

// `service-profile.ts` imports `@/lib/prisma` at MODULE LOAD, which throws
// without `DATABASE_URL`. This suite only exercises the two pure functions
// and never calls `loadServiceProfile`; the mock just keeps the import graph
// from crashing at load time (same pattern as `channel-series.test.ts`).
vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import {
  serviceProfile,
  dayOfWeekProfile,
  type DayOfWeekProfile,
} from "@/lib/counter/service-profile"

/* ── The measured d7 window, 2026-08-20 … 2026-08-26 (Hollywood) ────────── */
/*  0h:255  1h:98  2h:1  10h:43  11h:86  12h:121 13h:132 14h:115 15h:126
   16h:128 17h:143 18h:185 19h:192 20h:240 21h:245 22h:242 23h:284         */

const D7_HOUR_TOTALS: Array<[hour: number, total: number]> = [
  [0, 255], [1, 98], [2, 1],
  [10, 43], [11, 86], [12, 121], [13, 132], [14, 115], [15, 126],
  [16, 128], [17, 143], [18, 185], [19, 192], [20, 240], [21, 245],
  [22, 242], [23, 284],
]

const D7_DATES = [
  "2026-08-20", "2026-08-21", "2026-08-22", "2026-08-23",
  "2026-08-24", "2026-08-25", "2026-08-26",
]

/**
 * One row per hour, each hour's FULL measured total parked on a single date
 * (round-robin across the seven). `serviceProfile` aggregates by hour across
 * every date regardless of which date holds which count, so this reproduces
 * the exact measured per-hour totals while still exercising real multi-date
 * input — and keeps `coveredDays` at 7, since all seven dates are used.
 */
function d7Rows(): Array<{ hour: number; date: Date; orderCount: number }> {
  return D7_HOUR_TOTALS.map(([hour, total], i) => ({
    hour,
    date: new Date(`${D7_DATES[i % D7_DATES.length]}T00:00:00.000Z`),
    orderCount: total,
  }))
}

describe("serviceProfile", () => {
  it("covers all 7 days, averages 377 orders a day, busiest at 23h", () => {
    const p = serviceProfile(d7Rows())
    expect(p).not.toBeNull()
    expect(p!.coveredDays).toBe(7)
    expect(Math.round(p!.perDay)).toBe(377)
    expect(p!.busiest).toBe(23)
  })

  it("finds the peak block at 20h-0h, 48.0% share, labelled '8p to 1a'", () => {
    const p = serviceProfile(d7Rows())!
    expect(p.peak.startHour).toBe(20)
    expect(p.peak.endHour).toBe(0)
    expect(p.peak.share).toBeCloseTo(48.0, 1)
    expect(p.peak.label).toBe("8p to 1a")
  })

  it("orders hours by the SERVICE DAY, first trading hour first — not clock order", () => {
    const p = serviceProfile(d7Rows())!
    expect(p.hours[0].hour).toBe(10)
    expect(p.hours[p.hours.length - 1].hour).toBe(2)
    // NOT clock-ordered starting at 0.
    expect(p.hours[0].hour).not.toBe(0)
    expect(p.hours.map((h) => h.hour)).toEqual([
      10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2,
    ])
  })

  it("keeps the peak block inside a short trading day and never wraps past its end", () => {
    // A store trading only 10h-14h: exactly one five-hour window exists.
    // A buggy circular scan could report something like 13h -> 11h.
    const dates = ["2026-01-05", "2026-01-06", "2026-01-07"]
    const rows = [10, 11, 12, 13, 14].flatMap((hour) =>
      dates.map((d) => ({
        hour,
        date: new Date(`${d}T00:00:00.000Z`),
        orderCount: 10 + hour,
      })),
    )
    const p = serviceProfile(rows)!
    expect(p.hours.map((h) => h.hour)).toEqual([10, 11, 12, 13, 14])
    expect(p.peak.startHour).toBe(10)
    expect(p.peak.endHour).toBe(14)
    // Never a block that wraps back below its own start.
    expect(p.peak.endHour).toBeGreaterThanOrEqual(p.peak.startHour)
  })

  it("returns null under the three-day floor, and a profile at exactly three days", () => {
    const rowsFor = (dates: string[]) =>
      dates.flatMap((d) => [
        { hour: 10, date: new Date(`${d}T00:00:00.000Z`), orderCount: 5 },
        { hour: 20, date: new Date(`${d}T00:00:00.000Z`), orderCount: 8 },
      ])

    expect(serviceProfile(rowsFor(["2026-01-01", "2026-01-02"]))).toBeNull()
    expect(
      serviceProfile(rowsFor(["2026-01-01", "2026-01-02", "2026-01-03"])),
    ).not.toBeNull()
  })

  it("returns null for no rows at all", () => {
    expect(serviceProfile([])).toBeNull()
  })
})

describe("dayOfWeekProfile", () => {
  /**
   * 90 consecutive calendar days starting on a Friday, so the six weekdays
   * Fri..Wed each land 13 times and Thursday — the one left out of the
   * leftover six-day tail — lands 12 times. Matches the measured counts
   * exactly: Sun 13, Mon 13, Tue 13, Wed 13, Thu 12, Fri 13, Sat 13.
   *
   * Each date is assigned exactly its weekday's measured average as its net,
   * so every bucket's average reproduces the measured figure exactly with no
   * rounding — the point of the fixture is the GROUPING and WEIGHTING logic,
   * not re-deriving an average from a spread of individual days.
   */
  const AVERAGE_BY_JS_DAY: Record<number, number> = {
    0: 9018, // Sunday
    1: 7063, // Monday
    2: 6397, // Tuesday
    3: 6680, // Wednesday
    4: 6706, // Thursday
    5: 7325, // Friday
    6: 8444, // Saturday
  }

  function ninetyDays(): Array<{ date: Date; net: number }> {
    const start = new Date("2026-01-02T00:00:00.000Z") // a Friday (UTC)
    expect(start.getUTCDay()).toBe(5)

    const out: Array<{ date: Date; net: number }> = []
    for (let i = 0; i < 90; i += 1) {
      const date = new Date(start)
      date.setUTCDate(start.getUTCDate() + i)
      out.push({ date, net: AVERAGE_BY_JS_DAY[date.getUTCDay()] })
    }
    return out
  }

  // `dayOfWeekProfile` reads local `getDay()`. Build the fixture with local
  // dates constructed from the same UTC calendar sequence so `getDay()` and
  // `getUTCDay()` agree regardless of the machine's timezone.
  function ninetyDaysLocal(): Array<{ date: Date; net: number }> {
    return ninetyDays().map(({ date, net }) => ({
      date: new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
      net,
    }))
  }

  let profile: DayOfWeekProfile

  it("groups Sunday at 9018 average / 13 days, Tuesday at 6397 / 13 days", () => {
    profile = dayOfWeekProfile(ninetyDaysLocal())
    const sunday = profile.readings.find((r) => r.name === "Sunday")!
    const tuesday = profile.readings.find((r) => r.name === "Tuesday")!
    expect(sunday.average).toBeCloseTo(9018, 5)
    expect(sunday.days).toBe(13)
    expect(tuesday.average).toBeCloseTo(6397, 5)
    expect(tuesday.days).toBe(13)
  })

  it("picks Sunday as best, and computes mean as the day-count-weighted mean of the seven averages", () => {
    profile = dayOfWeekProfile(ninetyDaysLocal())
    const sundayIndex = profile.readings.findIndex((r) => r.name === "Sunday")
    expect(profile.best).toBe(sundayIndex)

    const totalNet = profile.readings.reduce(
      (s, r) => s + (r.average ?? 0) * r.days,
      0,
    )
    const totalDays = profile.readings.reduce((s, r) => s + r.days, 0)
    expect(profile.mean).toBeCloseTo(totalNet / totalDays, 6)
  })

  it("day: 0 is Monday, matching the chart's Mon-first labels", () => {
    profile = dayOfWeekProfile(ninetyDaysLocal())
    expect(profile.readings[0].name).toBe("Monday")
    expect(profile.readings[0].day).toBe(0)
    expect(profile.readings[6].name).toBe("Sunday")
    expect(profile.readings[6].day).toBe(6)
  })

  it("a weekday the range never held reads average: null, not 0", () => {
    // Only Monday and Tuesday ever occur in this range.
    const days = [
      { date: new Date(2026, 0, 5), net: 100 }, // a Monday
      { date: new Date(2026, 0, 6), net: 200 }, // a Tuesday
    ]
    const p = dayOfWeekProfile(days)
    const wednesday = p.readings.find((r) => r.name === "Wednesday")!
    expect(wednesday.average).toBeNull()
    expect(wednesday.days).toBe(0)
  })
})
