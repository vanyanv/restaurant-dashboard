// Pins the Monday-anchoring used by harri-labor-sync Phase 2.
//
// positions/pay_types is not per-day addressable (verified 2026-08-18):
// a Monday from_date returns the whole week, a non-Monday from_date 500s,
// and a range spilling past that week's Sunday 400s. These helpers turn an
// arbitrary day range into the one call shape the endpoint accepts.

import { describe, it, expect } from "vitest"
import { isoMondayUTC as isoWeekStart, isoWeekStartsCovering } from "@/lib/labor-week"

const d = (s: string) => new Date(s + "T00:00:00.000Z")
const iso = (x: Date) => x.toISOString().slice(0, 10)

describe("isoWeekStart", () => {
  it("returns the same day for a Monday", () => {
    expect(iso(isoWeekStart(d("2026-08-10")))).toBe("2026-08-10")
  })

  it("walks back to Monday from mid-week", () => {
    expect(iso(isoWeekStart(d("2026-08-13")))).toBe("2026-08-10")
  })

  it("treats Sunday as the END of its week, not the start", () => {
    // The classic off-by-one: getUTCDay() === 0 must map back 6 days.
    expect(iso(isoWeekStart(d("2026-08-16")))).toBe("2026-08-10")
  })

  it("crosses a month boundary", () => {
    expect(iso(isoWeekStart(d("2026-08-01")))).toBe("2026-07-27")
  })

  it("ignores the time component", () => {
    expect(iso(isoWeekStart(new Date("2026-08-13T23:59:59.999Z")))).toBe("2026-08-10")
  })
})

describe("isoWeekStartsCovering", () => {
  it("collapses a full week to a single call", () => {
    const days = ["2026-08-10","2026-08-11","2026-08-12","2026-08-13","2026-08-14","2026-08-15","2026-08-16"].map(d)
    expect(isoWeekStartsCovering(days).map(iso)).toEqual(["2026-08-10"])
  })

  it("returns one entry per week spanned, ascending", () => {
    // Thu -> next Tue spans two ISO weeks.
    const days = ["2026-08-13","2026-08-16","2026-08-17","2026-08-18"].map(d)
    expect(isoWeekStartsCovering(days).map(iso)).toEqual(["2026-08-10", "2026-08-17"])
  })

  it("sorts ascending regardless of input order", () => {
    const days = ["2026-08-18","2026-07-01","2026-08-13"].map(d)
    expect(isoWeekStartsCovering(days).map(iso)).toEqual([
      "2026-06-29", "2026-08-10", "2026-08-17",
    ])
  })

  it("returns nothing for an empty range", () => {
    expect(isoWeekStartsCovering([])).toEqual([])
  })

  it("makes one call per week for a 28-day range, not 28", () => {
    const days: Date[] = []
    for (let i = 0; i < 28; i++) {
      const x = d("2026-07-20"); x.setUTCDate(x.getUTCDate() + i); days.push(x)
    }
    expect(isoWeekStartsCovering(days)).toHaveLength(4)
  })
})
