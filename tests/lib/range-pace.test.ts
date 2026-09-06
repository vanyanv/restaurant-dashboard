// Overview's pace lines used to render only on "today": the hero strip fetched
// its comparison behind `range.days === 1`, and profit/margin had no comparison
// at all. These cover the generalisation — any selected range gets the same
// weekday-aligned four-week baseline — plus the two correctness bugs it
// surfaced (a "thru H PM" folio on finished days, and a baseline averaged over
// four slots when only some of them held data).

import { describe, it, expect } from "vitest"
import {
  parseDashboardRange,
  resolveRangeDates,
  DEFAULT_DASHBOARD_DAYS,
} from "@/lib/dashboard-utils"
import {
  bucketHourlyRows,
  deriveRangeSpec,
  formatPaceLine,
  rangeWeekdayLabel,
  avgTicketPacePct,
  type AggregateHourlyRow,
} from "@/lib/hourly-orders"
import type { OrderPatternsHourlyComparison } from "@/types/analytics"

// 2026-08-18 is a Tuesday.
const NOW = { todayLA: "2026-08-18", currentLAHour: 16 }

describe("parseDashboardRange", () => {
  it("defaults to yesterday, not a day still in progress", () => {
    expect(parseDashboardRange({})).toEqual({ kind: "days", days: -1 })
    expect(DEFAULT_DASHBOARD_DAYS).toBe(-1)
  })

  it("still honours an explicit range", () => {
    expect(parseDashboardRange({ days: "7" })).toEqual({ kind: "days", days: 7 })
    expect(parseDashboardRange({ start: "2026-08-01", end: "2026-08-03" })).toEqual({
      kind: "custom",
      startDate: "2026-08-01",
      endDate: "2026-08-03",
    })
  })
})

describe("resolveRangeDates", () => {
  it("matches how the analytics actions widen each preset", () => {
    expect(resolveRangeDates({ kind: "days", days: 1 }, "2026-08-18")).toEqual([
      "2026-08-18",
    ])
    expect(resolveRangeDates({ kind: "days", days: -1 }, "2026-08-18")).toEqual([
      "2026-08-17",
    ])
    // days=N is the N+1 days ending today, as getDashboardAnalytics resolves it.
    expect(resolveRangeDates({ kind: "days", days: 3 }, "2026-08-18")).toEqual([
      "2026-08-15",
      "2026-08-16",
      "2026-08-17",
      "2026-08-18",
    ])
  })

  it("walks a custom range inclusively and tolerates a reversed one", () => {
    expect(
      resolveRangeDates(
        { kind: "custom", startDate: "2026-08-16", endDate: "2026-08-18" },
        "2026-08-18"
      )
    ).toEqual(["2026-08-16", "2026-08-17", "2026-08-18"])
    expect(
      resolveRangeDates(
        { kind: "custom", startDate: "2026-08-18", endDate: "2026-08-16" },
        "2026-08-18"
      )
    ).toEqual(["2026-08-16", "2026-08-17", "2026-08-18"])
  })

  it("caps a hand-typed range so a pace lookup can't scan forever", () => {
    const dates = resolveRangeDates(
      { kind: "custom", startDate: "1970-01-01", endDate: "2026-08-18" },
      "2026-08-18"
    )
    expect(dates).toHaveLength(400)
  })
})

describe("deriveRangeSpec", () => {
  it("compares each day against the same weekday, 1–4 weeks back", () => {
    const spec = deriveRangeSpec({ kind: "days", days: -1 }, NOW)
    expect(spec.currentDates).toEqual(["2026-08-17"])
    expect(spec.comparisonGroups).toEqual([
      ["2026-08-10"],
      ["2026-08-03"],
      ["2026-07-27"],
      ["2026-07-20"],
    ])
  })

  it("applies the hour cutoff only when the range ends today", () => {
    expect(deriveRangeSpec({ kind: "days", days: 1 }, NOW).hourCutoff).toBe(16)
    expect(deriveRangeSpec({ kind: "days", days: 7 }, NOW).hourCutoff).toBe(16)
    expect(deriveRangeSpec({ kind: "days", days: -1 }, NOW).hourCutoff).toBeNull()
    expect(
      deriveRangeSpec(
        { kind: "custom", startDate: "2026-08-01", endDate: "2026-08-07" },
        NOW
      ).hourCutoff
    ).toBeNull()
  })

  it("keeps the baseline the same shape as the range", () => {
    const spec = deriveRangeSpec(
      { kind: "custom", startDate: "2026-08-10", endDate: "2026-08-16" },
      NOW
    )
    expect(spec.currentDates).toHaveLength(7)
    for (const group of spec.comparisonGroups) expect(group).toHaveLength(7)
    expect(spec.comparisonGroups[0][0]).toBe("2026-08-03")
  })
})

describe("rangeWeekdayLabel", () => {
  it("names one day by its weekday", () => {
    expect(rangeWeekdayLabel(["2026-08-18"])).toBe("Tue")
  })

  it("spans the ends of a week or less", () => {
    expect(rangeWeekdayLabel(["2026-08-16", "2026-08-17", "2026-08-18"])).toBe(
      "Sun–Tue"
    )
  })

  it("states the length of anything longer", () => {
    const dates = resolveRangeDates({ kind: "days", days: 29 }, "2026-08-18")
    expect(rangeWeekdayLabel(dates)).toBe("30 days")
  })
})

function cmp(
  over: Partial<OrderPatternsHourlyComparison> = {}
): OrderPatternsHourlyComparison {
  return {
    period: "range",
    groupTotals: [78, 80, 82],
    groupSalesTotals: [1560, 1600, 1640],
    currentTotal: 100,
    baselineTotal: 80,
    pacePct: 25,
    baselineWeeks: 4,
    weekdayLabel: "Tue",
    salesCurrentTotal: 2000,
    salesBaselineTotal: 1600,
    salesPacePct: 25,
    lastDataHour: 16,
    inProgress: true,
    ...over,
  }
}

describe("formatPaceLine", () => {
  it("keeps the 'thru' folio while the range is still filling", () => {
    expect(formatPaceLine(cmp(), 25)?.display).toBe(
      "▲ 25% vs avg Tue · thru 4 PM"
    )
  })

  it("drops it on a finished range, where it announced the last order taken", () => {
    expect(
      formatPaceLine(cmp({ inProgress: false, lastDataHour: 22 }), -11)?.display
    ).toBe("▼ 11% vs avg Tue")
  })

  it("stays silent below two baseline weeks", () => {
    expect(formatPaceLine(cmp({ baselineWeeks: 1 }), 25)).toBeNull()
  })
})

describe("avgTicketPacePct", () => {
  it("compares current $/order against baseline $/order", () => {
    // $2000/100 = $20 now, $1600/80 = $20 before → flat, even though both
    // sales and orders are up 25%.
    expect(avgTicketPacePct(cmp())).toBe(0)
    expect(
      avgTicketPacePct(cmp({ salesCurrentTotal: 2200 })) // $22 vs $20
    ).toBe(10)
  })

  it("returns null without orders on both sides", () => {
    expect(avgTicketPacePct(cmp({ currentTotal: 0 }))).toBeNull()
    expect(avgTicketPacePct(cmp({ baselineTotal: 0 }))).toBeNull()
  })
})

describe("bucketHourlyRows baseline averaging", () => {
  const spec = deriveRangeSpec({ kind: "days", days: -1 }, NOW)

  function rows(dates: Record<string, number>): AggregateHourlyRow[] {
    return Object.entries(dates).map(([date, orderCount]) => ({
      date,
      hour: 12,
      orderCount,
      netSales: orderCount * 10,
    }))
  }

  it("averages over the weeks that have data, not over all four slots", () => {
    // 100 today; three baseline weeks at 100 each, one week with no data.
    // Dividing by 4 gave a 75 baseline and a phantom +33%.
    const { hourlyComparison } = bucketHourlyRows({
      rows: rows({
        "2026-08-17": 100,
        "2026-08-10": 100,
        "2026-08-03": 100,
        "2026-07-27": 100,
      }),
      spec,
      period: "range",
    })
    expect(hourlyComparison?.baselineWeeks).toBe(3)
    expect(hourlyComparison?.baselineTotal).toBe(100)
    expect(hourlyComparison?.pacePct).toBe(0)
  })

  it("marks a finished range as not in progress", () => {
    const { hourlyComparison } = bucketHourlyRows({
      rows: rows({ "2026-08-17": 10 }),
      spec,
      period: "range",
    })
    expect(hourlyComparison?.inProgress).toBe(false)
  })
})

/**
 * Task 4b: the per-hour spread, published rather than averaged away.
 *
 * `avgOrderCount` is the MEAN of the four baseline weeks at an hour, and a
 * `{lo,hi}` built from a mean is a zero-width band drawn as if it were a
 * range. The rows behind that mean are already in hand, so each week's own
 * count for the hour is published beside it — and the mean itself is left
 * exactly as it was, because the Overview's pace lines read it.
 */
describe("bucketHourlyRows per-hour spread", () => {
  const spec = deriveRangeSpec({ kind: "days", days: -1 }, NOW)

  function at(hour: number, dates: Record<string, number>): AggregateHourlyRow[] {
    return Object.entries(dates).map(([date, orderCount]) => ({
      date,
      hour,
      orderCount,
      netSales: orderCount * 10,
    }))
  }

  const uneven = at(12, {
    "2026-08-17": 12, // the current day
    "2026-08-10": 10,
    "2026-08-03": 4,
    "2026-07-27": 7,
    // 2026-07-20 never traded: a week with NO data, not a week of zero.
  })

  it("publishes each baseline week's own count for the hour, and leaves the mean alone", () => {
    const { hourly } = bucketHourlyRows({ rows: uneven, spec, period: "range" })
    expect(hourly[12].groupOrderCounts).toEqual([10, 4, 7])
    // Unchanged — (10 + 4 + 7) over four slots. The Overview reads this.
    expect(hourly[12].avgOrderCount).toBe(5.3)
  })

  it("gives an hour no baseline week has data for no spread at all", () => {
    const { hourly } = bucketHourlyRows({ rows: uneven, spec, period: "range" })
    // An empty array, not [0, 0, 0]: nothing is known about 3 AM, and a floor
    // of zero drawn as a band would claim the kitchen normally takes none.
    expect(hourly[3].groupOrderCounts).toEqual([])
  })

  it("scales each group to its own day count, so a week-long band sits beside week-long bars", () => {
    const weekSpec = deriveRangeSpec(
      { kind: "custom", startDate: "2026-08-10", endDate: "2026-08-16" },
      NOW,
    )
    const { hourly } = bucketHourlyRows({
      rows: [
        { date: "2026-08-10", hour: 12, orderCount: 14, netSales: 140 },
        { date: "2026-08-03", hour: 12, orderCount: 8, netSales: 80 },
        { date: "2026-08-04", hour: 12, orderCount: 6, netSales: 60 },
      ],
      spec: weekSpec,
      period: "range",
    })
    // The bar is a per-day average over the seven-day range (14 / 7), so the
    // band has to be one too — a group SUM would draw a band seven times the
    // height of the bars it is meant to explain.
    expect(hourly[12].orderCount).toBe(2)
    expect(hourly[12].groupOrderCounts).toEqual([2])
  })
})
