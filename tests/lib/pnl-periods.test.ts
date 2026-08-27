import { describe, expect, it } from "vitest"
import { buildPeriods, bucketSummariesByPeriod, type OtterSummaryRow } from "@/lib/pnl"

// buildPeriods floors to UTC midnight, but used to walk forward with
// local-time date-fns (addDays, format, startOfWeek, endOfWeek, startOfMonth,
// endOfMonth, differenceInCalendarDays). In a non-UTC process that drifted
// every subsequent boundary off midnight, which (a) silently drops every
// daily row after a DST transition — bucketSummariesByPeriod matches a daily
// period on exact instant equality — and (b) mislabels every day one day
// early in any negative-offset zone, DST or not. This suite proves the fix
// no longer depends on the process's TZ.

const utcDay = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d))

/** A minimal OtterSummaryRow dated at UTC midnight, as OtterDailySummary.date is stored. */
const rowAt = (date: Date): { date: Date } & OtterSummaryRow => ({
  date,
  platform: "css-pos",
  paymentMethod: "CARD",
  fpGrossSales: 100,
  tpGrossSales: null,
  fpTaxCollected: null,
  tpTaxCollected: null,
  fpDiscounts: null,
  tpDiscounts: null,
  fpServiceCharges: null,
  tpServiceCharges: null,
})

describe("buildPeriods — daily, DST-crossing range (2026-03-05..12, US spring-forward)", () => {
  const start = utcDay(2026, 2, 5)
  const end = utcDay(2026, 2, 12)
  const periods = buildPeriods(start, end, "daily")

  it("yields 8 periods with startDate exactly at UTC midnight, no 23:00:00.000Z drift", () => {
    expect(periods).toHaveLength(8)
    const expected = [5, 6, 7, 8, 9, 10, 11, 12].map((d) => utcDay(2026, 2, d).toISOString())
    expect(periods.map((p) => p.startDate.toISOString())).toEqual(expected)
    expect(periods.map((p) => p.endDate.toISOString())).toEqual(expected)
    expect(periods.some((p) => p.startDate.toISOString().includes("T23:00:00.000Z"))).toBe(false)
  })

  it("labels the days Thu Mar 5 .. Thu Mar 12, not one day early", () => {
    expect(periods.map((p) => p.label)).toEqual([
      "Thu Mar 5",
      "Fri Mar 6",
      "Sat Mar 7",
      "Sun Mar 8",
      "Mon Mar 9",
      "Tue Mar 10",
      "Wed Mar 11",
      "Thu Mar 12",
    ])
  })

  it("places 8 of 8 rows dated at UTC midnight across the range", () => {
    const rows = [5, 6, 7, 8, 9, 10, 11, 12].map((d) => rowAt(utcDay(2026, 2, d)))
    const bucketed = bucketSummariesByPeriod(rows, periods)
    const placed = bucketed.reduce((n, b) => n + b.length, 0)
    expect(placed).toBe(8)
    // Assert the placed count, not just bucket shape: the pre-fix code
    // returned 8 empty buckets while silently dropping every row.
    expect(bucketed.map((b) => b.length)).toEqual([1, 1, 1, 1, 1, 1, 1, 1])
  })
})

describe("buildPeriods — daily, non-DST range (2026-08-20..26, the fidelity window)", () => {
  const start = utcDay(2026, 7, 20)
  const end = utcDay(2026, 7, 26)
  const periods = buildPeriods(start, end, "daily")

  it("yields 7 periods at exact UTC midnight", () => {
    expect(periods).toHaveLength(7)
    const expected = [20, 21, 22, 23, 24, 25, 26].map((d) => utcDay(2026, 7, d).toISOString())
    expect(periods.map((p) => p.startDate.toISOString())).toEqual(expected)
  })

  it("labels the days Thu Aug 20 .. Wed Aug 26 (the one-day-early defect is live here, no DST involved)", () => {
    expect(periods.map((p) => p.label)).toEqual([
      "Thu Aug 20",
      "Fri Aug 21",
      "Sat Aug 22",
      "Sun Aug 23",
      "Mon Aug 24",
      "Tue Aug 25",
      "Wed Aug 26",
    ])
  })

  it("places 7 of 7 rows", () => {
    const rows = [20, 21, 22, 23, 24, 25, 26].map((d) => rowAt(utcDay(2026, 7, d)))
    const bucketed = bucketSummariesByPeriod(rows, periods)
    expect(bucketed.reduce((n, b) => n + b.length, 0)).toBe(7)
  })
})

describe("buildPeriods — weekly and monthly keep every row across the DST-crossing range", () => {
  const start = utcDay(2026, 2, 5)
  const end = utcDay(2026, 2, 12)
  const rows = [5, 6, 7, 8, 9, 10, 11, 12].map((d) => rowAt(utcDay(2026, 2, d)))

  it("weekly: placed count equals row count", () => {
    const periods = buildPeriods(start, end, "weekly")
    const bucketed = bucketSummariesByPeriod(rows, periods)
    expect(bucketed.reduce((n, b) => n + b.length, 0)).toBe(rows.length)
  })

  it("monthly: placed count equals row count", () => {
    const periods = buildPeriods(start, end, "monthly")
    const bucketed = bucketSummariesByPeriod(rows, periods)
    expect(bucketed.reduce((n, b) => n + b.length, 0)).toBe(rows.length)
  })
})

describe("buildPeriods — a one-day range", () => {
  it("yields exactly one period", () => {
    const d = utcDay(2026, 7, 20)
    const periods = buildPeriods(d, d, "daily")
    expect(periods).toHaveLength(1)
    expect(periods[0].startDate.toISOString()).toBe(d.toISOString())
    expect(periods[0].endDate.toISOString()).toBe(d.toISOString())
    expect(periods[0].label).toBe("Thu Aug 20")
  })
})
