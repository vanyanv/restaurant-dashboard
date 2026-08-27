// shiftHours / staffingCurve / scheduleGap — the staffing curve's pure
// arithmetic, against "The measured data" in
// .superpowers/sdd/2026-08-27-counter-labor-fidelity/task-3-brief.md,
// 2026-08-28, Hollywood.
//
// `loadStaffingCurve`/`loadScheduleGap` are not unit-tested (loaders are not
// unit-tested per this task's rule — no mocked Prisma). The mock below only
// keeps `staffing-curve.ts`'s `@/lib/prisma` import from crashing at module
// load without `DATABASE_URL`, the same pattern as `labor-week.test.ts` and
// `service-profile.test.ts`.
import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import { shiftHours, staffingCurve, scheduleGap } from "@/lib/counter/staffing-curve"
import { newestGenerationPerHour } from "@/lib/counter/forecast-generation"

describe("shiftHours", () => {
  it("a day shift stops at its clock-out hour, exclusive", () => {
    expect(shiftHours(9, 17)).toEqual([9, 10, 11, 12, 13, 14, 15, 16])
  })

  // The midnight case. An implementation that stops at 23, or that bails to
  // `[]` when `end < start`, silently unstaffs the busiest hours of the
  // night (hour 23 is this restaurant's single busiest hour, measured).
  it("the midnight case: a shift ending at 1am staffs both sides of it", () => {
    expect(shiftHours(17, 1)).toEqual([17, 18, 19, 20, 21, 22, 23, 0])
  })

  it("a closing shift starting at 8pm and ending at 1am", () => {
    expect(shiftHours(20, 1)).toEqual([20, 21, 22, 23, 0])
  })
})

/*
 * The measured 2026-08-28 schedule and forecast ("The staffing curve,
 * 2026-08-28" and "The schedule runs out before the forecast does" tables
 * in task-3-brief.md).
 *
 * The brief publishes the AGGREGATE curve — people on the floor, hour by
 * hour — not Harri's raw per-shift start/end times for that day, which
 * aren't in the measured data anywhere. The roster below is RECONSTRUCTED
 * from it, not transcribed: ten shifts (matching the measured "69.5h · 10
 * shifts" shift COUNT for this day), built from the shift patterns the
 * brief names as real for this restaurant ("9→17, 12→17, 17→1, 18→1, 20→1")
 * plus two further plausible patterns needed to reproduce the measured step
 * from 3 people at 20h to 6 at 21h (a midday 10→15, and a 21→1 closer who
 * clocks in an hour after the evening crew).
 *
 * This is not circular: `shiftHours`'s hour-walk has no knowledge that
 * these are the target counts it needs to hit, and a broken midnight
 * expansion (the mutation check this file's brief calls for) collapses the
 * 17→1 and 21→1 groups' contribution to nothing — which does NOT match the
 * measured 3-then-6 step, and is exactly why the mutation is caught. Total
 * scheduled hours are not reconciled to the published 69.5h (real shifts
 * likely include half-hours this integer-hour model can't represent) — only
 * the per-hour headcount is asserted, and only at hours the brief actually
 * measured.
 */
const SHIFTS_2026_08_28 = [
  // 9→17 x3: hours 9..16.
  { startHour: 9, endHour: 17 },
  { startHour: 9, endHour: 17 },
  { startHour: 9, endHour: 17 },
  // 10→15 x1: the extra person over the measured 10h-14h peak.
  { startHour: 10, endHour: 15 },
  // 17→1 x3: hours 17..23 and 0 — on the floor at 20h.
  { startHour: 17, endHour: 1 },
  { startHour: 17, endHour: 1 },
  { startHour: 17, endHour: 1 },
  // 21→1 x3: the closing crew that arrives at 21h, not 20h — the measured step.
  { startHour: 21, endHour: 1 },
  { startHour: 21, endHour: 1 },
  { startHour: 21, endHour: 1 },
]

/*
 * Forecast orders, hour by hour, off the same table. 10h-14h and 15h-17h are
 * published only as ranges ("5.8 → 16.1", "16.9 → 18.9") — the values below
 * interpolate between the two published endpoints and are NOT independently
 * measured for every hour in between. Every hour whose gap against
 * `SHIFTS_2026_08_28`'s headcount could challenge the 20h maximum (18h-23h)
 * is the brief's own exact published figure, so the interpolated hours
 * cannot change which hour comes out `tightest`.
 */
const DEMAND_2026_08_28 = new Map<number, number>([
  [10, 5.8], [11, 9.0], [12, 12.0], [13, 14.0], [14, 16.1],
  [15, 16.9], [16, 17.9], [17, 18.9],
  [18, 26.8], [19, 33.2], [20, 38.4], [21, 36.1], [22, 35.6], [23, 39.4],
  // 9h is measured as "—": no forecast at all. Deliberately absent, not 0.
])

describe("staffingCurve — the measured 2026-08-28 shape", () => {
  const curve = staffingCurve(SHIFTS_2026_08_28, DEMAND_2026_08_28)

  it("scheduled is 3 at 20h and 6 at 21h", () => {
    const at = (h: number) => curve.hours.find((r) => r.hour === h)
    expect(at(20)?.scheduled).toBe(3)
    expect(at(21)?.scheduled).toBe(6)
  })

  it("9h has people but no forecast — demand is null, not 0", () => {
    const at9 = curve.hours.find((r) => r.hour === 9)
    expect(at9?.scheduled).toBe(3)
    expect(at9?.demand).toBeNull()
  })

  it("comes back in service-day order, not clock order", () => {
    const hours = curve.hours.map((r) => r.hour)
    expect(hours[0]).toBe(9)
    // The midnight hour (staffed by the 17→1 and 21→1 groups) sits at the
    // END of the axis, right after 23h — never at the front next to 9h,
    // which is what a plain ascending sort would do.
    expect(hours[hours.length - 2]).toBe(23)
    expect(hours[hours.length - 1]).toBe(0)
  })

  it("tightest is 20h — 38.4 forecast orders meeting 3 people", () => {
    expect(curve.tightest).toBe(20)
  })

  it("the sentence is computed from this curve's own numbers", () => {
    expect(curve.sentence).toContain("20h")
    expect(curve.sentence).toContain("3 people")
    expect(curve.sentence).toContain("38.4")
    expect(curve.sentence).toContain("21h")
    expect(curve.sentence).toContain("6 people")
    expect(curve.sentence).toContain("36.1")
  })
})

describe("staffingCurve — edges", () => {
  it("tightest is null with no forecast at all", () => {
    const curve = staffingCurve([{ startHour: 9, endHour: 17 }], new Map())
    expect(curve.tightest).toBeNull()
    expect(curve.sentence).not.toBe("")
  })

  it("an hour with forecast but no shift reads scheduled: 0, not absent", () => {
    const curve = staffingCurve([], new Map([[20, 10]]))
    expect(curve.hours).toEqual([{ hour: 20, scheduled: 0, demand: 10 }])
    expect(curve.tightest).toBe(20)
  })
})

/*
 * The rotation defect, measured on 2026-08-27.
 *
 * `ForecastHourlyOrders` publishes EVERY hour of the day, most of them zero.
 * Feeding all 24 keys to `serviceDayOrder` hands it a ring with no gap in it,
 * so the "largest gap" it rotates on is a tie at 1 hour, it starts back at the
 * set's own first element, and the axis degenerates to clock order — `12a …
 * 12p … 11p` — with the evening rush crushed against the right edge. The
 * Analytics hourly chart on the same restaurant starts at 10a, because
 * `OtterHourlySummary` never publishes an empty hour to begin with.
 *
 * The shifts are the ones the brief measured for that day (9→17 x3, 17→1 x3,
 * 18→1, 20→1) and the demand map carries all 24 keys with 9 of them zero
 * (hours 1–9), matching what the forecast actually publishes.
 */
describe("staffingCurve — a 24-key demand map must not produce a clock-ordered axis", () => {
  const SHIFTS_2026_08_27 = [
    { startHour: 9, endHour: 17 },
    { startHour: 9, endHour: 17 },
    { startHour: 9, endHour: 17 },
    { startHour: 17, endHour: 1 },
    { startHour: 17, endHour: 1 },
    { startHour: 17, endHour: 1 },
    { startHour: 18, endHour: 1 },
    { startHour: 20, endHour: 1 },
  ]

  // All 24 buckets published. Hours 1..9 are 0 — the forecast's own empty
  // buckets, which are not trading hours.
  const DEMAND_24 = new Map<number, number>([
    [0, 12.4],
    [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [7, 0], [8, 0], [9, 0],
    [10, 5.8], [11, 9.0], [12, 12.0], [13, 14.0], [14, 16.1],
    [15, 16.9], [16, 17.9], [17, 18.9], [18, 26.8], [19, 33.2],
    [20, 38.4], [21, 36.1], [22, 35.6], [23, 39.4],
  ])

  const curve = staffingCurve(SHIFTS_2026_08_27, DEMAND_24)

  it("the axis opens at 9h and closes past midnight, not at 0h and 23h", () => {
    const hours = curve.hours.map((r) => r.hour)
    expect(hours[0]).toBe(9)
    expect(hours[hours.length - 1]).toBe(0)
    // The defect's exact signature: a clock-ordered axis.
    expect(hours).not.toEqual(Array.from({ length: 24 }, (_, i) => i))
  })

  it("the forecast's empty buckets are not rows on the axis", () => {
    const hours = curve.hours.map((r) => r.hour)
    for (const dead of [1, 2, 3, 4, 5, 6, 7, 8]) {
      expect(hours).not.toContain(dead)
    }
    // 9h IS a row — a shift covers it — and its published forecast of zero is
    // carried through as 0 rather than dropped to null.
    expect(curve.hours.find((r) => r.hour === 9)?.demand).toBe(0)
    expect(curve.hours.find((r) => r.hour === 9)?.scheduled).toBe(3)
  })

  it("every trading hour is still on the axis, in one unbroken run", () => {
    expect(curve.hours.map((r) => r.hour)).toEqual([
      9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0,
    ])
  })

  it("tightest is still the hour demand most outruns the schedule", () => {
    // 23h: 39.4 forecast orders against the 5 people the evening shifts leave
    // on the floor — a wider gap than 20h's 38.4 against 5.
    expect(curve.tightest).toBe(23)
  })
})

describe("newestGenerationPerHour (L-R6) — the hourly forecast dedupe", () => {
  const gen = (hour: number, generatedAt: string, predictedOrders: number) => ({
    storeId: "s1",
    forecastDate: new Date("2026-08-28T00:00:00Z"),
    hourBucket: hour,
    predictedOrders,
    generatedAt: new Date(generatedAt),
  })

  it("keeps the newest generation by generatedAt, not by row order", () => {
    const rows = [
      gen(20, "2026-08-26T10:00:00Z", 12), // newest, written first in the array
      gen(20, "2026-08-24T10:00:00Z", 10),
      gen(20, "2026-08-25T10:00:00Z", 8),
    ]
    const out = newestGenerationPerHour(rows)
    expect(out).toHaveLength(1)
    expect(out[0].predictedOrders).toBe(12)
  })

  // The measurement this function exists for: `ForecastHourlyOrders` keeps
  // every generation, and summing three of them raw for one hour is exactly
  // the 13.17x trap L-R6 records for the real window.
  it("three generations of one hour: the raw sum is 3x the true figure", () => {
    const rows = [
      gen(20, "2026-08-24T10:00:00Z", 11),
      gen(20, "2026-08-25T10:00:00Z", 11),
      gen(20, "2026-08-26T10:00:00Z", 11),
    ]
    const deduped = newestGenerationPerHour(rows)
    expect(deduped).toHaveLength(1)
    expect(deduped[0].predictedOrders).toBe(11)

    const rawSum = rows.reduce((a, r) => a + r.predictedOrders, 0)
    expect(rawSum).toBe(33)
    expect(rawSum).toBe(deduped[0].predictedOrders * 3)
  })
})

describe("scheduleGap (L-R8)", () => {
  // "The schedule runs out before the forecast does" (task-3-brief.md).
  // Measured: 2026-08-27..2026-08-30 all carry a published schedule;
  // 2026-08-31 onward does not, while the forecast runs to 2026-09-09.
  const genDay = (date: string, orders: number) => ({
    storeId: "s1",
    forecastDate: new Date(`${date}T00:00:00Z`),
    hourBucket: 12,
    predictedOrders: orders,
    generatedAt: new Date("2026-08-27T06:00:00Z"),
  })

  const forecastRows = [
    genDay("2026-08-27", 345),
    genDay("2026-08-28", 365),
    genDay("2026-08-29", 415),
    genDay("2026-08-30", 432),
    genDay("2026-08-31", 380),
    genDay("2026-09-01", 331),
    genDay("2026-09-02", 343),
    genDay("2026-09-03", 341),
  ]

  const scheduledDates = new Set([
    "2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30",
  ])

  it("returns days from 2026-08-31, and not 2026-08-30 which has a schedule", () => {
    const gap = scheduleGap({ scheduledDates, forecastRows })
    expect(gap.map((g) => g.date)).toEqual([
      "2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03",
    ])
  })

  it("carries the measured forecast-order totals through unchanged", () => {
    const gap = scheduleGap({ scheduledDates, forecastRows })
    expect(gap.find((g) => g.date === "2026-08-31")?.forecastOrders).toBe(380)
    expect(gap.find((g) => g.date === "2026-09-03")?.forecastOrders).toBe(341)
  })

  it("a day with full forecast coverage and no gap returns empty", () => {
    expect(scheduleGap({ scheduledDates: new Set(["2026-08-27"]), forecastRows: [genDay("2026-08-27", 345)] })).toEqual([])
  })
})
