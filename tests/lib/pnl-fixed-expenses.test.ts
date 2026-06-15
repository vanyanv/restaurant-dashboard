import { describe, expect, it } from "vitest"
import {
  computeStorePnL,
  monthlyFromFrequency,
  CUSTOM_FIXED_CODE_PREFIX,
  AFTER_LABOR_RENT_CODE,
  type CustomFixedExpense,
  type OtterSummaryRow,
  type Period,
  type StoreFixedInputs,
} from "@/lib/pnl"

const DAYS_PER_MONTH = 365.25 / 12

const store: StoreFixedInputs = {
  fixedMonthlyLabor: null,
  fixedMonthlyRent: null,
  fixedMonthlyTowels: null,
  fixedMonthlyCleaning: null,
  uberCommissionRate: 0.21,
  doordashCommissionRate: 0.25,
}

/** A single FP credit-card sales row of `gross`. */
const fpCardRow = (gross: number): OtterSummaryRow => ({
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

const period = (days: number): Period => ({
  label: `P-${days}`,
  startDate: new Date(Date.UTC(2026, 3, 1)),
  endDate: new Date(Date.UTC(2026, 3, days)),
  days,
  isPartial: false,
})

const expense = (
  id: string,
  label: string,
  monthlyAmount: number
): CustomFixedExpense => ({
  code: `${CUSTOM_FIXED_CODE_PREFIX}${id}`,
  label,
  monthlyAmount,
})

describe("computeStorePnL custom fixed expenses", () => {
  it("is backward compatible: no expenses reproduces the baseline", () => {
    const base = computeStorePnL({ bucketed: [[fpCardRow(10_000)]], periods: [period(30)], store })
    const withEmpty = computeStorePnL({
      bucketed: [[fpCardRow(10_000)]],
      periods: [period(30)],
      store,
      customFixedExpenses: [],
    })
    expect(withEmpty.rows.length).toBe(base.rows.length)
    expect(withEmpty.bottomLine).toEqual(base.bottomLine)
    expect(withEmpty.customFixedValues).toEqual([])
  })

  it("prorates a monthly expense over a full-month period", () => {
    const c = computeStorePnL({
      bucketed: [[fpCardRow(10_000)]],
      periods: [period(30)],
      store,
      customFixedExpenses: [expense("a", "Insurance", 1000)],
    })
    const expected = (1000 * 30) / DAYS_PER_MONTH
    expect(c.customFixedValues).toHaveLength(1)
    expect(c.customFixedValues[0][0]).toBeCloseTo(expected, 6)
    const row = c.rows.find((r) => r.code === `${CUSTOM_FIXED_CODE_PREFIX}a`)!
    expect(row.label).toBe("Insurance")
    expect(row.isFixed).toBe(true)
    expect(row.values[0]).toBeCloseTo(-expected, 6)
  })

  it("prorates a weekly cadence correctly via monthlyFromFrequency", () => {
    const monthly = monthlyFromFrequency(50, "WEEKLY") // 50 * 52 / 12
    const c = computeStorePnL({
      bucketed: [[fpCardRow(10_000)]],
      periods: [period(7)],
      store,
      customFixedExpenses: [expense("p", "Pest control", monthly)],
    })
    const expected = (monthly * 7) / DAYS_PER_MONTH
    expect(c.customFixedValues[0][0]).toBeCloseTo(expected, 6)
  })

  it("reduces the bottom line by the sum of all custom expenses", () => {
    const gross = 10_000
    const expenses = [expense("a", "Insurance", 1000), expense("b", "POS", 300)]
    const c = computeStorePnL({
      bucketed: [[fpCardRow(gross)]],
      periods: [period(30)],
      store,
      customFixedExpenses: expenses,
    })
    const customTotal = c.customFixedValues.reduce((acc, arr) => acc + arr[0], 0)
    const after = c.rows.find((r) => r.code === AFTER_LABOR_RENT_CODE)!
    // No COGS / labor / rent / cleaning / towels configured here, so the
    // bottom line is just net sales minus the custom expenses.
    expect(after.values[0]).toBeCloseTo(gross - customTotal, 6)
    expect(c.bottomLine[0]).toBeCloseTo(gross - customTotal, 6)
    // Both custom rows are present, each with its FX_ code.
    expect(c.rows.filter((r) => r.code.startsWith(CUSTOM_FIXED_CODE_PREFIX))).toHaveLength(2)
  })

  it("inserts custom rows after Towels and before the bottom-line subtotal", () => {
    const c = computeStorePnL({
      bucketed: [[fpCardRow(10_000)]],
      periods: [period(30)],
      store,
      customFixedExpenses: [expense("a", "Insurance", 1000)],
    })
    const codes = c.rows.map((r) => r.code)
    const fxIdx = codes.indexOf(`${CUSTOM_FIXED_CODE_PREFIX}a`)
    expect(fxIdx).toBeGreaterThan(codes.indexOf("7220")) // after Towels
    expect(fxIdx).toBeLessThan(codes.indexOf(AFTER_LABOR_RENT_CODE)) // before bottom line
  })
})
