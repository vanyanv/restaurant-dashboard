/**
 * The labour blend's honesty about what it does not know.
 *
 * `computeStorePnL` blends Harri clock-in actuals for the days Harri covers
 * with `fixedMonthlyLabor` prorated across the days it does not. When there is
 * no `fixedMonthlyLabor` on file, `monthlyCostForDays` returns null and the
 * caller coalesces it to 0 — so the uncovered days contribute NOTHING. Not a
 * smaller estimate: an omission.
 *
 * `isUnknown` is the only thing that says so, and it used to require
 * `coveredDays === 0` on top of the missing budget, which is not what its own
 * comment said ("flag as unknown only when the fixed estimate is also
 * missing"). So one synced day out of seven was enough to present a week's
 * labour — built from that one day — as a known figure.
 *
 * It matters because of which way it is wrong. Labour understated means the
 * bottom line, the margin and prime cost are all overstated, and a figure that
 * flatters the business is the one nobody goes looking into.
 */
import { describe, expect, it } from "vitest"
import {
  computeStorePnL,
  LABOR_CODE,
  type OtterSummaryRow,
  type Period,
  type StoreFixedInputs,
} from "@/lib/pnl"

const BUDGETED: StoreFixedInputs = {
  fixedMonthlyLabor: 30_000,
  fixedMonthlyRent: 8_000,
  fixedMonthlyTowels: null,
  fixedMonthlyCleaning: null,
  uberCommissionRate: 0.21,
  doordashCommissionRate: 0.25,
}

/** The store the bug lived on: Harri connected, no labour budget typed in. */
const NO_BUDGET: StoreFixedInputs = { ...BUDGETED, fixedMonthlyLabor: null }

const sales = (gross: number): OtterSummaryRow => ({
  platform: "css-pos",
  paymentMethod: "CARD",
  fpGrossSales: gross,
  tpGrossSales: null,
  fpTaxCollected: null,
  tpTaxCollected: null,
  fpDiscounts: null,
  tpDiscounts: null,
  fpServiceCharges: null,
  tpServiceCharges: null,
})

const week: Period[] = [
  {
    label: "W1",
    startDate: new Date(Date.UTC(2026, 3, 1)),
    endDate: new Date(Date.UTC(2026, 3, 7)),
    days: 7,
    isPartial: false,
  },
]

function laborRow(store: StoreFixedInputs, coveredDays: number, actualUsd: number) {
  const computed = computeStorePnL({
    bucketed: [[sales(20_000)]],
    periods: week,
    store,
    harriLaborByPeriod: [{ actualUsd, coveredDays }],
  })
  const row = computed.rows.find((r) => r.code === LABOR_CODE)!
  return { value: computed.laborValues[0], unknown: row.isUnknown?.[0] ?? false, label: row.label }
}

describe("labour coverage — what the blend admits to", () => {
  it("flags partial coverage as unknown when there is no budget to fill the gap", () => {
    // Three days of clock-ins, four days of nothing, no budget to prorate.
    const { value, unknown } = laborRow(NO_BUDGET, 3, 2_400)
    expect(value).toBe(2_400) // four days contributed $0
    expect(unknown).toBe(true) // ...and the row says so
  })

  it("flagged it known before, on one covered day out of seven", () => {
    // The old condition was `fixedMonthlyLabor == null && coveredDays === 0`,
    // so any coverage at all cleared the flag while the arithmetic still
    // dropped every uncovered day.
    expect(laborRow(NO_BUDGET, 1, 800).unknown).toBe(true)
    expect(laborRow(NO_BUDGET, 6, 4_800).unknown).toBe(true)
  })

  it("is still unknown with no coverage and no budget, as it always was", () => {
    const { value, unknown } = laborRow(NO_BUDGET, 0, 0)
    expect(value).toBe(0)
    expect(unknown).toBe(true)
  })

  it("is known once the week is fully covered, budget or not", () => {
    expect(laborRow(NO_BUDGET, 7, 5_600).unknown).toBe(false)
    expect(laborRow(BUDGETED, 7, 5_600).unknown).toBe(false)
  })

  it("is known on partial coverage when a budget DOES fill the gap", () => {
    // 30,000/month over a 30.4375-day month is ~$985.62/day; three covered
    // days of clock-ins plus four days of that estimate is a real figure.
    const { value, unknown } = laborRow(BUDGETED, 3, 2_400)
    expect(unknown).toBe(false)
    expect(value).toBeGreaterThan(2_400)
  })
})

describe("a stored fixedMonthlyLabor of 0 is not a budget", () => {
  const ZERO_BUDGET: StoreFixedInputs = { ...BUDGETED, fixedMonthlyLabor: 0 }

  it("reads as unknown, like null, when Harri covers only part of the period", () => {
    const zero = laborRow(ZERO_BUDGET, 3, 2_400)
    const none = laborRow(NO_BUDGET, 3, 2_400)
    expect(zero).toEqual(none)
    expect(zero.unknown).toBe(true)
  })

  it("is not labelled a fixed figure when nothing is covered", () => {
    expect(laborRow(ZERO_BUDGET, 0, 0).label).toBe("Labor (estimated)")
    expect(laborRow(ZERO_BUDGET, 0, 0).unknown).toBe(true)
  })

  it("still uses a real budget", () => {
    expect(laborRow(BUDGETED, 0, 0).label).toBe("Labor (fixed)")
  })
})

describe("a pre-open store: no sales and no labor reading", () => {
  function preOpen(store: StoreFixedInputs) {
    const computed = computeStorePnL({
      bucketed: [[]],
      periods: week,
      store,
      harriLaborByPeriod: [{ actualUsd: 0, coveredDays: 0 }],
    })
    const row = computed.rows.find((r) => r.code === LABOR_CODE)!
    return { value: computed.laborValues[0], unknown: row.isUnknown?.[0] ?? false }
  }

  it("is charged no fixed labor and is not flagged unknown", () => {
    expect(preOpen(BUDGETED)).toEqual({ value: 0, unknown: false })
  })

  it("is not flagged unknown without a budget either", () => {
    expect(preOpen(NO_BUDGET)).toEqual({ value: 0, unknown: false })
  })

  it("an open store with sales and no reading still falls back to the budget", () => {
    expect(laborRow(BUDGETED, 0, 0).value).toBeGreaterThan(0)
  })
})
