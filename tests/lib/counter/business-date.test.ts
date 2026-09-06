import { afterEach, describe, expect, it, vi } from "vitest"
import { businessCalendarDate, businessDay } from "@/lib/counter/business-date"
import { comparisonRange, dayCount, isoDay, rangeTitle, toQueryBounds } from "@/lib/counter/date-range"
import { readCounterParams } from "@/lib/counter/url-state"
import { counterToday } from "@/lib/counter/today"

afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers() })

describe("Los Angeles business dates", () => {
  it.each([
    ["2026-09-06T02:00:00Z", "2026-09-05"],
    ["2026-01-01T07:59:59Z", "2025-12-31"],
    ["2026-01-01T08:00:00Z", "2026-01-01"],
    ["2026-03-08T07:59:59Z", "2026-03-07"],
    ["2026-03-08T08:00:00Z", "2026-03-08"],
    ["2026-03-08T10:00:00Z", "2026-03-08"],
    ["2026-03-09T07:00:00Z", "2026-03-09"],
    ["2026-11-01T06:59:59Z", "2026-10-31"],
    ["2026-11-01T07:00:00Z", "2026-11-01"],
    ["2026-11-01T09:00:00Z", "2026-11-01"],
    ["2026-11-02T08:00:00Z", "2026-11-02"],
  ])("%s belongs to %s, regardless of the runtime zone", (instant, expected) => {
    expect(businessDay(new Date(instant))).toBe(expected)
    expect(isoDay(businessCalendarDate(new Date(instant)))).toBe(expected)
  })

  it("uses Friday's data and label for Yesterday on Saturday evening in LA", () => {
    const now = new Date("2026-09-06T02:00:00Z")
    const { range } = readCounterParams(new URLSearchParams(), now)
    expect(rangeTitle(range)).toBe("Friday's numbers")
    expect(toQueryBounds(range).startDate.toISOString()).toBe("2026-09-04T00:00:00.000Z")
    expect(toQueryBounds(range).endDate.toISOString()).toBe("2026-09-04T23:59:59.000Z")
  })

  it("keeps seven calendar days and weekday comparisons across DST", () => {
    const { range } = readCounterParams(new URLSearchParams("range=d7"), new Date("2026-03-10T02:00:00Z"))
    expect(isoDay(range.start)).toBe("2026-03-03")
    expect(isoDay(range.end)).toBe("2026-03-09")
    expect(dayCount(range)).toBe(7)
    expect(isoDay(comparisonRange(range, "prev")!.start)).toBe("2026-02-24")
    expect(isoDay(comparisonRange(range, "weekday")!.end)).toBe("2026-03-02")
  })

  it("does not timezone-shift explicit dates in a shared link", () => {
    const { range } = readCounterParams(new URLSearchParams("from=2026-09-01&to=2026-09-05"), new Date("2026-09-06T02:00:00Z"))
    expect(isoDay(range.start)).toBe("2026-09-01")
    expect(isoDay(range.end)).toBe("2026-09-05")
  })

  it("pins the same business day in every environment and rejects rolled-over dates", () => {
    vi.stubEnv("VERCEL_ENV", undefined)
    vi.stubEnv("COUNTER_TODAY", "2026-08-28")
    expect(businessDay(counterToday())).toBe("2026-08-28")
    vi.useFakeTimers().setSystemTime(new Date("2026-09-06T02:00:00Z"))
    vi.stubEnv("COUNTER_TODAY", "2026-02-31")
    expect(counterToday()).toEqual(new Date())
    vi.stubEnv("COUNTER_TODAY", "2026-08-28")
    vi.stubEnv("VERCEL_ENV", "production")
    expect(counterToday()).toEqual(new Date())
  })
})
