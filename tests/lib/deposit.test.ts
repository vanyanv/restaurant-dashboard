// One deposit formula.
//
// `otter-analytics-aggregation.ts` subtracted `Math.abs()` of tax remitted,
// fees and paid-out; `dashboard-analytics-actions.ts` ADDED the same three
// columns unmodified, behind a warning that fires if any arrives positive.
// Both are right while Otter's convention holds — those columns are signed
// deductions — and they diverge the day it does not, with the `Math.abs()`
// copy failing silently.

import { describe, it, expect } from "vitest"
import { computeDeposit } from "@/lib/deposit"

/** A real-shaped day: $10,000 net, tax collected and remitted, a fee, tips. */
const day = {
  netSales: 10_000,
  taxCollected: 950,
  taxRemitted: -950,
  tips: 300,
  serviceCharges: 120,
  fees: -1_500,
  paidIn: 200,
  paidOut: -80,
}

describe("computeDeposit", () => {
  it("nets the signed deductions out of the day", () => {
    const d = computeDeposit(day)
    // 10,000 + 950 − 950 + 300 + 120 − 1,500
    expect(d.theoreticalDeposit).toBe(8_920)
    expect(d.expectedDeposit).toBe(8_920 + 200 - 80)
    expect(d.signDrift).toEqual([])
  })

  it("agrees with the Math.abs() reading while the convention holds", () => {
    const d = computeDeposit(day)
    const abs =
      day.netSales +
      day.taxCollected -
      Math.abs(day.taxRemitted) +
      day.tips +
      day.serviceCharges -
      Math.abs(day.fees)
    expect(d.theoreticalDeposit).toBe(abs)
  })

  it("names every column that came back with the wrong sign", () => {
    const d = computeDeposit({ ...day, taxRemitted: 950, fees: 1_500, paidOut: 80 })
    expect(d.signDrift).toEqual(["taxRemitted", "fees", "paidOut"])
    // And it says so rather than quietly subtracting a positive figure: the
    // deposit comes back inflated, which is what the caller warns about.
    expect(d.theoreticalDeposit).toBeGreaterThan(day.netSales)
  })

  it("treats a zero deduction as convention-compliant, not as drift", () => {
    expect(computeDeposit({ ...day, taxRemitted: 0, fees: 0, paidOut: 0 }).signDrift).toEqual([])
  })
})
