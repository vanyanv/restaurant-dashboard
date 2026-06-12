// Pins the week-window arithmetic and weekly aggregation shared by
// /dashboard/labor/[storeId] and /m/labor. Both pages previously computed
// this inline; the math here must match those pages byte-for-byte:
//  - weekEnd is day 7 at UTC midnight (HarriDailyLabor.date is @db.Date, so
//    rows live at UTC midnight and lte-midnight includes day 7)
//  - variancePct is null when there is no forecast
//  - hasPrior requires a non-null actual AND a positive prior total
//  - the overbudget threshold is 5%

import { describe, it, expect } from "vitest"
import {
  buildLaborWeekWindow,
  aggregateLaborWeek,
  groupAlertsByDate,
  LABOR_OVERBUDGET_THRESHOLD,
} from "@/lib/labor-week"

const NOW = new Date("2026-06-12T15:00:00Z") // a Friday; Monday is 2026-06-08

describe("buildLaborWeekWindow", () => {
  it("builds the Monday-aligned window for an explicit week param", () => {
    const w = buildLaborWeekWindow("2026-05-20", NOW) // a Wednesday
    expect(w.weekIso).toBe("2026-05-18")
    expect(w.weekStart.toISOString()).toBe("2026-05-18T00:00:00.000Z")
    expect(w.weekEnd.toISOString()).toBe("2026-05-24T00:00:00.000Z")
    expect(w.priorWeekStart.toISOString()).toBe("2026-05-11T00:00:00.000Z")
    expect(w.priorWeekEnd.toISOString()).toBe("2026-05-17T00:00:00.000Z")
    expect(w.thisWeekIso).toBe("2026-06-08")
    expect(w.isCurrentWeek).toBe(false)
  })

  it("defaults to the current week and flags it", () => {
    const w = buildLaborWeekWindow(undefined, NOW)
    expect(w.weekIso).toBe("2026-06-08")
    expect(w.isCurrentWeek).toBe(true)
  })
})

describe("aggregateLaborWeek", () => {
  const row = (actual: number | null, forecast: number | null) => ({
    actualCost: actual,
    forecastCost: forecast,
  })

  it("totals actual/forecast and computes variance", () => {
    const agg = aggregateLaborWeek(
      [row(1000, 900), row(1100, 1000), row(null, 1000)],
      [row(2000, null)]
    )
    expect(agg.totalActual).toBe(2100)
    expect(agg.totalForecast).toBe(2900)
    expect(agg.variance).toBe(-800)
    expect(agg.variancePct).toBeCloseTo(-800 / 2900)
    expect(agg.overbudget).toBe(false)
    expect(agg.daysWithData).toBe(2)
  })

  it("returns null variancePct when there is no forecast", () => {
    const agg = aggregateLaborWeek([row(500, null)], [])
    expect(agg.totalForecast).toBe(0)
    expect(agg.variancePct).toBeNull()
    expect(agg.overbudget).toBe(false)
  })

  it("flags overbudget above the 5% threshold", () => {
    const agg = aggregateLaborWeek([row(1060, 1000)], [])
    expect(LABOR_OVERBUDGET_THRESHOLD).toBe(0.05)
    expect(agg.variancePct).toBeCloseTo(0.06)
    expect(agg.overbudget).toBe(true)
  })

  it("computes week-over-week only when prior data exists and is positive", () => {
    const withPrior = aggregateLaborWeek([row(1100, null)], [row(1000, null)])
    expect(withPrior.priorActual).toBe(1000)
    expect(withPrior.hasPrior).toBe(true)
    expect(withPrior.wowDelta).toBeCloseTo(0.1)
    expect(withPrior.wowOverbudget).toBe(true)

    const noPrior = aggregateLaborWeek([row(1100, null)], [])
    expect(noPrior.hasPrior).toBe(false)
    expect(noPrior.wowDelta).toBeNull()
    expect(noPrior.wowOverbudget).toBe(false)

    // rows exist but all-null actuals -> no prior signal
    const nullPrior = aggregateLaborWeek([row(1100, null)], [row(null, 500)])
    expect(nullPrior.hasPrior).toBe(false)
  })
})

describe("groupAlertsByDate", () => {
  it("groups alert rows by their date key, preserving order", () => {
    const alerts = [
      { date: "2026-06-08", kind: "a" },
      { date: "2026-06-09", kind: "b" },
      { date: "2026-06-08", kind: "c" },
    ]
    const grouped = groupAlertsByDate(alerts)
    expect(Object.keys(grouped)).toEqual(["2026-06-08", "2026-06-09"])
    expect(grouped["2026-06-08"].map((a) => a.kind)).toEqual(["a", "c"])
  })
})
