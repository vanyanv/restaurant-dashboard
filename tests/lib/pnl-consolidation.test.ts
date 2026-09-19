import { describe, expect, it } from "vitest"
import {
  computeStorePnL,
  consolidateRows,
  CUSTOM_FIXED_CODE_PREFIX,
  LABOR_CODE,
  TOTAL_SALES_CODE,
  type CustomFixedExpense,
  type OtterSummaryRow,
  type Period,
  type StoreFixedInputs,
} from "@/lib/pnl"

const store: StoreFixedInputs = {
  fixedMonthlyLabor: 30_000,
  fixedMonthlyRent: 8_000,
  fixedMonthlyTowels: null,
  fixedMonthlyCleaning: null,
  uberCommissionRate: 0.21,
  doordashCommissionRate: 0.25,
}

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

const periods: Period[] = [
  {
    label: "P1",
    startDate: new Date(Date.UTC(2026, 3, 1)),
    endDate: new Date(Date.UTC(2026, 3, 30)),
    days: 30,
    isPartial: false,
  },
]

const exp = (id: string, label: string, monthly: number): CustomFixedExpense => ({
  code: `${CUSTOM_FIXED_CODE_PREFIX}${id}`,
  label,
  monthlyAmount: monthly,
})

describe("consolidateRows", () => {
  it("merges legacy rows by sum and keeps each store's distinct custom expenses", () => {
    const a = computeStorePnL({
      bucketed: [[fpCardRow(10_000)]],
      periods,
      store,
      customFixedExpenses: [exp("a1", "Insurance", 1000)],
    })
    const b = computeStorePnL({
      bucketed: [[fpCardRow(6_000)]],
      periods,
      store,
      customFixedExpenses: [exp("b1", "POS subscription", 200)],
    })

    const merged = consolidateRows([a.rows, b.rows], periods)
    const codes = merged.map((r) => r.code)

    // Shared (legacy) rows appear exactly once and are summed.
    const total = merged.find((r) => r.code === TOTAL_SALES_CODE)!
    expect(total.values[0]).toBeCloseTo(16_000, 6)
    expect(codes.filter((c) => c === TOTAL_SALES_CODE)).toHaveLength(1)

    // Both stores' custom expenses survive as separate FX_ lines.
    const fxCodes = codes.filter((c) => c.startsWith(CUSTOM_FIXED_CODE_PREFIX))
    expect(fxCodes).toEqual([`${CUSTOM_FIXED_CODE_PREFIX}a1`, `${CUSTOM_FIXED_CODE_PREFIX}b1`])

    // A store lacking the other's expense contributes 0 to that line.
    const insurance = merged.find((r) => r.code === `${CUSTOM_FIXED_CODE_PREFIX}a1`)!
    expect(insurance.values[0]).toBeCloseTo(a.rows.find((r) => r.code === `${CUSTOM_FIXED_CODE_PREFIX}a1`)!.values[0], 6)
  })

  it("sums shared custom expense codes when both stores have them", () => {
    const shared = exp("shared", "Insurance", 1000)
    const a = computeStorePnL({ bucketed: [[fpCardRow(10_000)]], periods, store, customFixedExpenses: [shared] })
    const b = computeStorePnL({ bucketed: [[fpCardRow(6_000)]], periods, store, customFixedExpenses: [shared] })
    const merged = consolidateRows([a.rows, b.rows], periods)
    const fxRows = merged.filter((r) => r.code.startsWith(CUSTOM_FIXED_CODE_PREFIX))
    expect(fxRows).toHaveLength(1)
    const single = a.rows.find((r) => r.code === shared.code)!.values[0]
    expect(fxRows[0].values[0]).toBeCloseTo(single * 2, 6)
  })
})

describe("consolidateRows — what the group total does not know", () => {
  /** A store with a labour budget on file, and one without. */
  const funded = { ...store, fixedMonthlyLabor: 30_000 }
  const unfunded = { ...store, fixedMonthlyLabor: null }

  it("flags the summed line unknown when ANY contributing store is", () => {
    // Hollywood knows its labour; Glendale does not and contributes $0 to the
    // sum. The total is short a whole store, and the flag has to say so —
    // requiring EVERY store to be unknown is the test for "we know nothing
    // about this line", not for "this total is missing one".
    const a = computeStorePnL({ bucketed: [[fpCardRow(10_000)]], periods, store: funded })
    const b = computeStorePnL({
      bucketed: [[fpCardRow(6_000)]],
      periods,
      store: unfunded,
      harriLaborByPeriod: periods.map(() => ({ actualUsd: 0, coveredDays: 0 })),
    })

    const merged = consolidateRows([a.rows, b.rows], periods)
    const labor = merged.find((r) => r.code === LABOR_CODE)!
    expect(labor.isUnknown?.[0]).toBe(true)
  })

  it("leaves it known when every contributing store knows its own figure", () => {
    const a = computeStorePnL({ bucketed: [[fpCardRow(10_000)]], periods, store: funded })
    const b = computeStorePnL({ bucketed: [[fpCardRow(6_000)]], periods, store: funded })
    const labor = consolidateRows([a.rows, b.rows], periods).find((r) => r.code === LABOR_CODE)!
    expect(labor.isUnknown).toBeUndefined()
  })

  it("does not stamp the group line with one store's parenthetical", () => {
    // "Labor (actual)" is a claim about the data behind ONE store. The first
    // store in the list used to name the line for all of them.
    const a = computeStorePnL({
      bucketed: [[fpCardRow(10_000)]],
      periods,
      store: funded,
      harriLaborByPeriod: periods.map((p) => ({ actualUsd: 2_000, coveredDays: p.days })),
    })
    const b = computeStorePnL({ bucketed: [[fpCardRow(6_000)]], periods, store: funded })

    expect(a.rows.find((r) => r.code === LABOR_CODE)!.label).toBe("Labor (actual)")
    expect(b.rows.find((r) => r.code === LABOR_CODE)!.label).toBe("Labor (fixed)")
    expect(consolidateRows([a.rows, b.rows], periods).find((r) => r.code === LABOR_CODE)!.label)
      .toBe("Labor")
  })

  it("keeps the label when every store tells the same story", () => {
    const a = computeStorePnL({ bucketed: [[fpCardRow(10_000)]], periods, store: funded })
    const b = computeStorePnL({ bucketed: [[fpCardRow(6_000)]], periods, store: funded })
    expect(consolidateRows([a.rows, b.rows], periods).find((r) => r.code === LABOR_CODE)!.label)
      .toBe("Labor (fixed)")
  })
})
