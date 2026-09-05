// The lane says Thursday is 8.2 hours short. It can't say *when*, and a
// manager schedules shifts, not day-totals.
//
// ForecastHourlyOrders has the demand curve and HarriShift has the posted
// coverage, so the drawer can cross them. Two things the data forced:
//
//  - The store trades past midnight. Predicted orders peak at hour 23 (40.7)
//    and are still 36.4 at hour 0, 14.5 at hour 1. Rendering 00:00-23:00 would
//    split the evening across both ends of the chart, so the window runs
//    10:00 -> 01:00 and hours 0 and 1 belong to the *previous* trading day.
//  - "Needed" per hour uses the same idea as the daily lane: the store's own
//    throughput, here orders per labor hour, rather than a target nobody set.

import { describe, it, expect } from "vitest"
import {
  OPERATING_HOURS,
  buildHourlyCoverage,
} from "@/lib/decisions/hourly-coverage"

const flat = (orders: number, staffed: number) =>
  OPERATING_HOURS.map((hour) => ({ hour, predictedOrders: orders, staffedHours: staffed }))

describe("OPERATING_HOURS", () => {
  it("runs from opening to close, wrapping past midnight", () => {
    expect(OPERATING_HOURS[0]).toBe(10)
    expect(OPERATING_HOURS[OPERATING_HOURS.length - 1]).toBe(1)
    expect(OPERATING_HOURS).toContain(23)
    expect(OPERATING_HOURS).toContain(0)
  })

  it("keeps the evening contiguous — 23 immediately precedes 0", () => {
    const i = OPERATING_HOURS.indexOf(23)
    expect(OPERATING_HOURS[i + 1]).toBe(0)
  })

  it("excludes the dead overnight hours", () => {
    for (const h of [2, 3, 4, 5, 6, 7, 8, 9]) {
      expect(OPERATING_HOURS).not.toContain(h)
    }
  })
})

describe("buildHourlyCoverage", () => {
  it("turns each hour's demand into the labor hours it takes", () => {
    const out = buildHourlyCoverage(flat(20, 4), 10)
    expect(out.hours[0].neededHours).toBe(2)
  })

  it("flags only the hours where demand outruns coverage", () => {
    const rows = [
      { hour: 18, predictedOrders: 20, staffedHours: 4 },  // needs 2, has 4
      { hour: 19, predictedOrders: 60, staffedHours: 4 },  // needs 6, has 4
      { hour: 20, predictedOrders: 70, staffedHours: 4 },  // needs 7, has 4
    ]
    const out = buildHourlyCoverage(rows, 10)
    expect(out.hours.map((h) => h.isShort)).toEqual([false, true, true])
  })

  it("names the stretch that is short, because a manager posts a shift not an hour", () => {
    const rows = [
      { hour: 17, predictedOrders: 10, staffedHours: 4 },
      { hour: 18, predictedOrders: 60, staffedHours: 4 },
      { hour: 19, predictedOrders: 70, staffedHours: 4 },
      { hour: 20, predictedOrders: 65, staffedHours: 4 },
      { hour: 21, predictedOrders: 10, staffedHours: 4 },
    ]
    const out = buildHourlyCoverage(rows, 10)
    // gaps: 6pm -2, 7pm -3, 8pm -2.5
    expect(out.worstStretch).toEqual({ startHour: 18, endHour: 21, shortHours: 7.5 })
  })

  it("picks the longest stretch when several are short", () => {
    const rows = [
      { hour: 12, predictedOrders: 60, staffedHours: 4 },
      { hour: 13, predictedOrders: 10, staffedHours: 4 },
      { hour: 18, predictedOrders: 60, staffedHours: 4 },
      { hour: 19, predictedOrders: 60, staffedHours: 4 },
      { hour: 20, predictedOrders: 60, staffedHours: 4 },
    ]
    const out = buildHourlyCoverage(rows, 10)
    expect(out.worstStretch?.startHour).toBe(18)
    expect(out.worstStretch?.endHour).toBe(21)
  })

  it("reports no stretch when the day is covered", () => {
    expect(buildHourlyCoverage(flat(20, 8), 10).worstStretch).toBeNull()
  })

  it("scales the chart to the busiest hour so the shape is readable", () => {
    const rows = [
      { hour: 18, predictedOrders: 10, staffedHours: 1 },
      { hour: 19, predictedOrders: 40, staffedHours: 1 },
    ]
    const out = buildHourlyCoverage(rows, 10)
    expect(out.peakOrders).toBe(40)
  })

  it("says nothing rather than dividing by a throughput it doesn't have", () => {
    const out = buildHourlyCoverage(flat(20, 4), null)
    expect(out.hours[0].neededHours).toBeNull()
    expect(out.hours[0].isShort).toBe(false)
    expect(out.worstStretch).toBeNull()
  })

  it("treats a nonsensical throughput as absent", () => {
    expect(buildHourlyCoverage(flat(20, 4), 0).hours[0].neededHours).toBeNull()
    expect(buildHourlyCoverage(flat(20, 4), -5).hours[0].neededHours).toBeNull()
  })

  it("handles a day with no published shifts", () => {
    const out = buildHourlyCoverage(
      OPERATING_HOURS.map((hour) => ({ hour, predictedOrders: 30, staffedHours: 0 })), 10,
    )
    expect(out.hours.every((h) => h.isShort)).toBe(true)
    expect(out.worstStretch?.startHour).toBe(10)
  })

  it("returns an empty shape for an empty day rather than throwing", () => {
    const out = buildHourlyCoverage([], 10)
    expect(out.hours).toEqual([])
    expect(out.peakOrders).toBe(0)
    expect(out.worstStretch).toBeNull()
  })
})
