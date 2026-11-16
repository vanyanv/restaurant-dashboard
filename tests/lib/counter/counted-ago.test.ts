// "Counted N days ago" is worded once, in the stores' own (Los Angeles)
// calendar days, for the Inventory overview, the Shelf tab and Order next.

import { describe, it, expect } from "vitest"
import { businessDaysSince, countedAgo } from "@/lib/counter/counted-ago"

// 2026-11-16 is PST (UTC-8): 07:00Z is 11pm the evening before in Los Angeles.
describe("countedAgo", () => {
  it("is today for a count earlier the same Los Angeles day, however many hours ago", () => {
    expect(countedAgo(new Date("2026-11-15T16:30:00Z"), new Date("2026-11-16T07:30:00Z"))).toBe("today")
  })

  it("is yesterday two hours after an 11pm count", () => {
    const at = new Date("2026-11-16T07:00:00Z") // Sun 11pm in LA
    const now = new Date("2026-11-16T09:00:00Z") // Mon 1am in LA
    expect(countedAgo(at, now)).toBe("yesterday")
  })

  it("is yesterday 30 hours after a morning count, not 'today' and not '2 days ago'", () => {
    expect(countedAgo(new Date("2026-11-14T17:00:00Z"), new Date("2026-11-15T23:00:00Z"))).toBe("yesterday")
  })

  it("counts calendar days after that", () => {
    expect(countedAgo(new Date("2026-11-07T20:00:00Z"), new Date("2026-11-16T18:00:00Z"))).toBe("9 days ago")
    expect(businessDaysSince(new Date("2026-11-07T20:00:00Z"), new Date("2026-11-16T18:00:00Z"))).toBe(9)
  })

  it("is whole days across the clock change", () => {
    // Nov 1, 2026 is the end of daylight time in Los Angeles: a 25-hour day.
    expect(businessDaysSince(new Date("2026-10-31T19:00:00Z"), new Date("2026-11-02T20:00:00Z"))).toBe(2)
  })

  it("never reads a count from a moment ahead as negative", () => {
    expect(countedAgo(new Date("2026-11-17T20:00:00Z"), new Date("2026-11-16T20:00:00Z"))).toBe("today")
  })
})
