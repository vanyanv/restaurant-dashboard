// "Did it work?" is a causal question, and normally that needs a control group
// nobody has. But ForecastDailyRevenue stamps generatedAt, so the forecast made
// *before* a decision is, by construction, an estimate of what would have
// happened without it. Freeze it at commit time and it becomes the
// counterfactual.
//
// The significance test counts days landing outside the frozen 80% band rather
// than comparing summed totals. Two reasons:
//
//  - Summing daily p10/p90 assumes the days are perfectly correlated, which
//    makes the band so wide nothing is ever significant.
//  - Counting exceedances is self-calibrating against the interval itself: under
//    the null, 10% of days should sit above p90. If the band is honest the test
//    is honest, and the band's calibration is measured separately.

import { describe, it, expect } from "vitest"
import {
  binomialTailAtLeast,
  computeDecisionOutcome,
  MIN_DAYS_TO_JUDGE,
  type FrozenDay,
} from "@/app/dashboard/decisions/lib/decision-outcome"

const day = (date: string, predicted: number, spread = 1000): FrozenDay => ({
  date,
  predicted,
  p10: predicted - spread,
  p90: predicted + spread,
})

const week = (start = 1, predicted = 6000) =>
  Array.from({ length: 7 }, (_, i) =>
    day(`2026-08-${String(start + i).padStart(2, "0")}`, predicted),
  )

const actuals = (frozen: FrozenDay[], values: number[]) =>
  new Map(frozen.map((f, i) => [f.date, values[i]]))

describe("binomialTailAtLeast", () => {
  it("matches known values for P(X >= k) at p = 0.1", () => {
    // n=7: P(X>=0)=1, and the tail shrinks fast.
    expect(binomialTailAtLeast(7, 0, 0.1)).toBeCloseTo(1, 10)
    expect(binomialTailAtLeast(7, 1, 0.1)).toBeCloseTo(1 - 0.9 ** 7, 10)
    expect(binomialTailAtLeast(7, 7, 0.1)).toBeCloseTo(0.1 ** 7, 12)
  })

  it("three of seven days above an 80% band is significant at 5%", () => {
    expect(binomialTailAtLeast(7, 3, 0.1)).toBeLessThan(0.05)
    expect(binomialTailAtLeast(7, 2, 0.1)).toBeGreaterThan(0.05)
  })

  it("is monotonic in k", () => {
    const tails = [0, 1, 2, 3, 4, 5].map((k) => binomialTailAtLeast(10, k, 0.1))
    for (let i = 1; i < tails.length; i++) expect(tails[i]).toBeLessThan(tails[i - 1])
  })
})

describe("computeDecisionOutcome", () => {
  it("withholds a verdict until enough days have closed", () => {
    const frozen = week()
    const out = computeDecisionOutcome(frozen, actuals(frozen, [9000, 9000]))
    expect(out.verdict).toBe("measuring")
    expect(out.daysObserved).toBe(2)
    expect(MIN_DAYS_TO_JUDGE).toBeGreaterThan(2)
  })

  it("calls a run of days above the band working", () => {
    const frozen = week()
    const out = computeDecisionOutcome(frozen, actuals(frozen, Array(7).fill(7500)))
    expect(out.verdict).toBe("working")
    expect(out.daysAbove).toBe(7)
    expect(out.deltaUsd).toBeCloseTo(7 * 1500, 6)
  })

  it("calls a run of days below the band backfiring", () => {
    const frozen = week()
    const out = computeDecisionOutcome(frozen, actuals(frozen, Array(7).fill(4200)))
    expect(out.verdict).toBe("backfiring")
    expect(out.daysBelow).toBe(7)
    expect(out.deltaUsd).toBeLessThan(0)
  })

  it("reports no clear effect when days land inside the band", () => {
    const frozen = week()
    const out = computeDecisionOutcome(frozen, actuals(frozen, [6100, 5900, 6200, 5800, 6050, 6000, 5950]))
    expect(out.verdict).toBe("no-clear-effect")
    expect(out.daysAbove).toBe(0)
  })

  it("does not call it working on a single lucky day", () => {
    const frozen = week()
    const out = computeDecisionOutcome(frozen, actuals(frozen, [9000, 6000, 6000, 6000, 6000, 6000, 6000]))
    expect(out.daysAbove).toBe(1)
    expect(out.verdict).toBe("no-clear-effect")
  })

  it("needs three of seven above the band, matching the 5% threshold", () => {
    const frozen = week()
    const two = computeDecisionOutcome(frozen, actuals(frozen, [9000, 9000, 6000, 6000, 6000, 6000, 6000]))
    const three = computeDecisionOutcome(frozen, actuals(frozen, [9000, 9000, 9000, 6000, 6000, 6000, 6000]))
    expect(two.verdict).toBe("no-clear-effect")
    expect(three.verdict).toBe("working")
  })

  it("counts only days that actually closed", () => {
    const frozen = week()
    const partial = new Map([[frozen[0].date, 7500], [frozen[1].date, 7500], [frozen[2].date, 7500], [frozen[3].date, 7500]])
    const out = computeDecisionOutcome(frozen, partial)
    expect(out.daysObserved).toBe(4)
    expect(out.forecastUsd).toBeCloseTo(4 * 6000, 6)
  })

  it("reports the delta against the frozen forecast, not against zero", () => {
    const frozen = week(1, 6000)
    const out = computeDecisionOutcome(frozen, actuals(frozen, Array(7).fill(6500)))
    expect(out.forecastUsd).toBeCloseTo(42000, 6)
    expect(out.actualUsd).toBeCloseTo(45500, 6)
    expect(out.deltaUsd).toBeCloseTo(3500, 6)
  })

  it("survives a day with no band without counting it as an exceedance", () => {
    const frozen: FrozenDay[] = [
      { date: "2026-08-01", predicted: 6000, p10: null, p90: null },
      ...week(2).slice(0, 6),
    ]
    const out = computeDecisionOutcome(frozen, actuals(frozen, Array(7).fill(7500)))
    expect(out.daysObserved).toBe(7)
    expect(out.daysAbove).toBe(6)
  })

  it("handles an empty freeze rather than dividing by nothing", () => {
    const out = computeDecisionOutcome([], new Map())
    expect(out.verdict).toBe("measuring")
    expect(out.daysObserved).toBe(0)
    expect(out.deltaUsd).toBe(0)
  })

  it("separates 'no baseline was captured' from 'no days have closed yet'", () => {
    // Both report zero observed days, and they mean opposite things: one is a
    // broken commit, the other is a decision taken this morning.
    const nothingFrozen = computeDecisionOutcome([], new Map())
    const frozenButFresh = computeDecisionOutcome(week(), new Map())
    expect(nothingFrozen.frozenDays).toBe(0)
    expect(frozenButFresh.frozenDays).toBe(7)
    expect(nothingFrozen.daysObserved).toBe(frozenButFresh.daysObserved)
  })
})
