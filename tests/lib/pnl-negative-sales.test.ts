// The P&L percent column against a negative Total Sales.
//
// Every percent in `computeStorePnL` divided by `totalSales[i]` after testing
// it for exact zero only. A period whose Total Sales came out negative — a
// range of refunds posted against a closed period, a late correction — divides
// fine and flips the sign of the whole column.

import { describe, it, expect } from "vitest"
import { pctOfSales, percents } from "@/lib/pnl"

describe("pctOfSales", () => {
  it("is the plain share when sales are positive", () => {
    expect(pctOfSales(250, 1000)).toBeCloseTo(0.25, 10)
  })

  it("returns 0 rather than Infinity when there were no sales", () => {
    expect(pctOfSales(250, 0)).toBe(0)
  })

  it("returns 0 rather than an inverted share when sales are negative", () => {
    // 4000 / -200 is -20, which the column renders as -2000%. COGS of $4,000
    // against a refund period is not "minus two thousand percent of sales";
    // there is no denominator, so there is no percentage.
    expect(pctOfSales(4000, -200)).toBe(0)
    expect(pctOfSales(-900, -200)).toBe(0)
  })

  it("does not turn a loss into a positive margin", () => {
    // Two negatives divide to a positive: Net Income of -$900 on Total Sales
    // of -$200 printed as +450%.
    expect(pctOfSales(-900, -200)).not.toBeGreaterThan(0)
  })
})

describe("percents", () => {
  it("zeroes the whole column on a negative total, not just a zero one", () => {
    expect(percents([100, -50], -200)).toEqual([0, 0])
    expect(percents([100, -50], 0)).toEqual([0, 0])
    expect(percents([100, -50], 200)).toEqual([0.5, -0.25])
  })
})
