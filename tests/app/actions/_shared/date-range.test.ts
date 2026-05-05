// Pure-helper test: parseDateRange must produce the same
// {startDate, endDate} pair the inline blocks in product-usage-actions.ts and
// store-actions.ts produce, so we can swap the inline code for the helper
// without changing behavior.

import { describe, it, expect } from "vitest"
import { parseDateRange } from "@/app/actions/_shared/date-range"

describe("parseDateRange", () => {
  it("uses explicit startDate + endDate when both are provided (start at 00:00:00, end at 23:59:59)", () => {
    const { startDate, endDate } = parseDateRange(
      { startDate: "2026-01-15", endDate: "2026-01-20" },
      30
    )
    // Constructed via `new Date("2026-01-15T00:00:00")` (local TZ) — match that exactly
    expect(startDate.getTime()).toBe(new Date("2026-01-15T00:00:00").getTime())
    expect(endDate.getTime()).toBe(new Date("2026-01-20T23:59:59").getTime())
  })

  it("falls back to days-ago when explicit dates are not provided", () => {
    const before = Date.now()
    const { startDate, endDate } = parseDateRange({ days: 7 }, 30)
    const after = Date.now()

    // endDate is "now" (within the test execution window)
    expect(endDate.getTime()).toBeGreaterThanOrEqual(before)
    expect(endDate.getTime()).toBeLessThanOrEqual(after)

    // startDate is endDate minus exactly 7 days (in calendar days, like setDate(d-7))
    const expectedStart = new Date(endDate)
    expectedStart.setDate(expectedStart.getDate() - 7)
    expect(startDate.getTime()).toBe(expectedStart.getTime())
  })

  it("uses the supplied defaultDays when neither days nor explicit dates are passed", () => {
    const { startDate, endDate } = parseDateRange({}, 90)
    const expectedStart = new Date(endDate)
    expectedStart.setDate(expectedStart.getDate() - 90)
    expect(startDate.getTime()).toBe(expectedStart.getTime())
  })

  it("treats undefined options the same as empty options (uses defaultDays)", () => {
    const { startDate, endDate } = parseDateRange(undefined, 30)
    const expectedStart = new Date(endDate)
    expectedStart.setDate(expectedStart.getDate() - 30)
    expect(startDate.getTime()).toBe(expectedStart.getTime())
  })

  it("falls back to days when only one of startDate/endDate is provided (matches existing behavior)", () => {
    // Original code requires BOTH startStr && endStr to use explicit; otherwise falls back
    const { startDate, endDate } = parseDateRange(
      { startDate: "2026-01-15", days: 14 },
      30
    )
    const expectedStart = new Date(endDate)
    expectedStart.setDate(expectedStart.getDate() - 14)
    expect(startDate.getTime()).toBe(expectedStart.getTime())
  })
})
