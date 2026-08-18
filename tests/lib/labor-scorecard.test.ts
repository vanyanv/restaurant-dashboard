import { describe, it, expect } from "vitest"
import { scorecardTargets, buildScorecard, scorecardTotals } from "@/lib/labor-scorecard"

const input = (date: string, netSales: number, actualHours: number, scheduledHours = actualHours) => ({
  date, netSales, actualHours, scheduledHours, laborCost: actualHours * 20, alertCount: 0,
})

describe("scorecardTargets", () => {
  it("buckets by weekday and takes the median", () => {
    // 2026-08-03 / 08-10 / 08-17 are Mondays.
    const t = scorecardTargets([
      input("2026-08-03", 1000, 10), // 100
      input("2026-08-10", 1200, 10), // 120
      input("2026-08-17", 1400, 10), // 140
    ])
    expect(t[1]).toBeCloseTo(120, 6)
  })
  it("leaves weekdays with no history null", () => {
    expect(scorecardTargets([input("2026-08-03", 1000, 10)])[4]).toBeNull()
  })
  it("skips zero-hour days rather than producing Infinity", () => {
    const t = scorecardTargets([input("2026-08-03", 1000, 0), input("2026-08-10", 1000, 10)])
    expect(t[1]).toBeCloseTo(100, 6)
  })
})

describe("buildScorecard", () => {
  const targets = scorecardTargets([input("2026-08-03", 1000, 10)]) // Mon target 100

  it("separates schedule drift from earned-hours variance", () => {
    // Published 16h, worked 15h, sales justify 12h.
    const [r] = buildScorecard([input("2026-08-10", 1200, 15, 16)], targets, 20)
    expect(r.scheduleDriftHours).toBeCloseTo(1, 6)   // 16 - 15
    expect(r.earnedHours).toBeCloseTo(12, 6)
    expect(r.varianceHours).toBeCloseTo(3, 6)        // 15 - 12
    expect(r.varianceDollars).toBeCloseTo(60, 6)
    expect(r.status).toBe("over")
  })

  it("computes labor percentage of sales", () => {
    const [r] = buildScorecard([input("2026-08-10", 1000, 10)], targets, 20)
    expect(r.laborPct).toBeCloseTo(0.2, 6) // $200 cost / $1000
  })

  it("leaves splh null on a zero-hour day instead of dividing by zero", () => {
    const [r] = buildScorecard([input("2026-08-10", 900, 0)], targets, 20)
    expect(r.splh).toBeNull()
    expect(r.status).toBe("unknown")
  })

  it("returns unknown when the weekday has no target", () => {
    const [r] = buildScorecard([input("2026-08-13", 1000, 10)], targets, 20) // Thursday
    expect(r.earnedHours).toBeNull()
    expect(r.status).toBe("unknown")
  })

  it("labels the weekday", () => {
    const [r] = buildScorecard([input("2026-08-10", 1000, 10)], targets, 20)
    expect(r.weekday).toBe("Mon")
  })
})

describe("scorecardTotals", () => {
  const targets = scorecardTargets([input("2026-08-03", 1000, 10)])

  it("sums hours, sales and cost", () => {
    const rows = buildScorecard(
      [input("2026-08-10", 1000, 10, 11), input("2026-08-17", 2000, 20, 21)],
      targets, 20
    )
    const t = scorecardTotals(rows)
    expect(t.netSales).toBe(3000)
    expect(t.actualHours).toBe(30)
    expect(t.scheduledHours).toBe(32)
    expect(t.laborCost).toBe(600)
  })

  it("derives total SPLH from totals, not by averaging daily SPLH", () => {
    const rows = buildScorecard(
      [input("2026-08-10", 1000, 10), input("2026-08-17", 5000, 20)],
      targets, 20
    )
    // Weighted: 6000/30 = 200. Averaging 100 and 250 would give 175.
    expect(scorecardTotals(rows).splh).toBeCloseTo(200, 6)
  })

  it("excludes days without a target from the variance total", () => {
    const rows = buildScorecard(
      [input("2026-08-10", 1200, 15), input("2026-08-13", 9999, 10)], // Thu has no target
      targets, 20
    )
    expect(scorecardTotals(rows).varianceHours).toBeCloseTo(3, 6)
  })

  it("returns null splh when nothing was worked", () => {
    const rows = buildScorecard([input("2026-08-10", 0, 0)], targets, 20)
    expect(scorecardTotals(rows).splh).toBeNull()
  })
})
