// Task 3c (A-R19): `toQueryBounds` used to add `23:59:59` in LOCAL time while
// `buildPeriods` floors its cursor with `startOfDayUTC` — two frames, one
// handoff. Off UTC, that handoff widened a 7-day range into 8 days of
// periods AND 8 days of query rows (see task-3c-brief.md for the full
// reproduction and the $50,192-vs-$48,425 P&L defect).
//
// These assertions are written to hold in every process timezone — run them
// under TZ=UTC, TZ=America/Los_Angeles (negative offset) and TZ=Asia/Kolkata
// (positive, non-integer offset). All three must produce IDENTICAL results,
// because the bounds `toQueryBounds` returns are UTC instants regardless of
// where the process clock sits.
import { describe, expect, it } from "vitest"
import { resolvePreset, toQueryBounds, dayCount, type DateRange } from "@/lib/counter/date-range"
import { buildPeriods } from "@/lib/pnl"

// Fixed instant from the brief's reproduction. 12:00Z keeps the local
// calendar date at Aug 27 in every zone from UTC-12 to UTC+12, so `today`
// resolves to the same calendar day everywhere this suite runs.
const TODAY = new Date("2026-08-27T12:00:00Z")

describe("toQueryBounds — UTC-anchored, not local-time-anchored", () => {
  it("a d7 range resolved at the brief's instant yields the exact UTC bounds, in every zone", () => {
    const range = resolvePreset("d7", TODAY)
    const bounds = toQueryBounds(range)
    expect(bounds.startDate.toISOString()).toBe("2026-08-21T00:00:00.000Z")
    expect(bounds.endDate.toISOString()).toBe("2026-08-27T23:59:59.000Z")
  })

  it("startDate sits at UTC midnight and endDate at UTC 23:59:59 — asserted on the UTC getters directly", () => {
    const range = resolvePreset("d7", TODAY)
    const bounds = toQueryBounds(range)
    expect(bounds.startDate.getUTCHours()).toBe(0)
    expect(bounds.startDate.getUTCMinutes()).toBe(0)
    expect(bounds.startDate.getUTCSeconds()).toBe(0)
    expect(bounds.endDate.getUTCHours()).toBe(23)
    expect(bounds.endDate.getUTCMinutes()).toBe(59)
    expect(bounds.endDate.getUTCSeconds()).toBe(59)
  })

  it("buildPeriods over those bounds at daily granularity yields exactly 7 periods, correctly labelled", () => {
    const range = resolvePreset("d7", TODAY)
    const bounds = toQueryBounds(range)
    const periods = buildPeriods(bounds.startDate, bounds.endDate, "daily")

    // The count alone is not enough — under the old local-time bounds,
    // Asia/Kolkata produced the right COUNT (7) for the WRONG seven days
    // (shifted a day earlier). Naming every label catches that a bare
    // `toHaveLength(7)` would have missed.
    expect(periods).toHaveLength(7)
    expect(periods.map((p) => p.label)).toEqual([
      "Fri Aug 21", "Sat Aug 22", "Sun Aug 23", "Mon Aug 24",
      "Tue Aug 25", "Wed Aug 26", "Thu Aug 27",
    ])
  })

  it("a single-day range (today) yields one period, not two", () => {
    const range = resolvePreset("today", TODAY)
    const bounds = toQueryBounds(range)
    const periods = buildPeriods(bounds.startDate, bounds.endDate, "daily")
    expect(periods).toHaveLength(1)
    expect(periods[0].label).toBe("Thu Aug 27")
  })

  // The invariant the bug broke: `dayCount(range)` is Counter's own promise
  // about how many days a range covers (it drives the date control's label
  // and every "N days" subtitle). The defect was that `buildPeriods`, fed
  // `toQueryBounds`'s output, silently produced ONE MORE period than
  // `dayCount` said the range held. Asserted across three different preset
  // shapes (a week, a month, a single day) rather than as a one-off number.
  it("dayCount(range) equals the number of daily periods toQueryBounds+buildPeriods produce", () => {
    const presets: DateRange[] = [
      resolvePreset("d7", TODAY),
      resolvePreset("d30", TODAY),
      resolvePreset("today", TODAY),
    ]
    for (const range of presets) {
      const bounds = toQueryBounds(range)
      const periods = buildPeriods(bounds.startDate, bounds.endDate, "daily")
      expect(periods).toHaveLength(dayCount(range))
    }
  })
})
