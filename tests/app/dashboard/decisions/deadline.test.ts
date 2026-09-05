// Every action card shipped with `doByDate = today + 7`, so all five rendered
// the same date regardless of what kind of decision they were. A reprice bleeds
// value every day it isn't taken; a menu change is a thirty-day play. The
// deadline is derived from the generator's own `horizonDays` rather than a
// constant, so it can't drift away from the number the impact was computed over.

import { describe, it, expect } from "vitest"
import { deadlineFor } from "@/lib/decisions/deadline"

const TODAY = "2026-08-18" // a Tuesday

describe("deadlineFor", () => {
  it("marks a daily-horizon opportunity as decaying, with no date to hide behind", () => {
    expect(deadlineFor(1, TODAY)).toEqual({ kind: "decays" })
  })

  it("gives week-horizon opportunities a real date at the end of their window", () => {
    expect(deadlineFor(7, TODAY)).toEqual({
      kind: "date",
      date: "2026-08-25",
      daysLeft: 7,
    })
  })

  it("treats a month-long play as a horizon, not a deadline", () => {
    expect(deadlineFor(30, TODAY)).toEqual({ kind: "horizon", days: 30 })
  })

  it("crosses a month boundary correctly", () => {
    expect(deadlineFor(7, "2026-08-28")).toEqual({
      kind: "date",
      date: "2026-09-04",
      daysLeft: 7,
    })
  })

  it("falls back to the seven-day window when the generator reports no horizon", () => {
    expect(deadlineFor(null, TODAY)).toEqual({
      kind: "date",
      date: "2026-08-25",
      daysLeft: 7,
    })
  })

  it("treats a zero or negative horizon as decaying rather than emitting a past date", () => {
    expect(deadlineFor(0, TODAY)).toEqual({ kind: "decays" })
    expect(deadlineFor(-3, TODAY)).toEqual({ kind: "decays" })
  })
})
