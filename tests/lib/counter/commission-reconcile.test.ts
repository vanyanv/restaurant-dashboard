// Commission when the order rows are missing or partial (review, 2026-10-28).
//
// OtterOrder history starts 2026-01-02; OtterDailySummary starts 2025-02-21,
// and the order sync can lag the summary. Per store/day/platform the rows are
// trusted only when they cover ≥ 90% of the summary's tpOrderCount; below that
// the slice is priced at the store's DELIVERY rate × the slice's net sales
// (gross + discounts + refunds) and marked estimated.

import { describe, it, expect } from "vitest"
import {
  bucketCommission,
  commissionBasis,
  commissionIsEstimated,
  ORDER_ROW_COVERAGE_FLOOR,
  salesSlices,
  totalCommission,
  type OrderFeeGroup,
  type SalesSlice,
  type StoreCommissionRates,
} from "@/lib/counter/commission-core"
import { buildPeriods, summarySlices, type OtterSummaryRow } from "@/lib/pnl"
import { parseRatePercent, percentToFraction } from "@/lib/counter/commission-rate-input"

const RATES: StoreCommissionRates = {
  id: "s1",
  uberCommissionRate: 0.27,
  doordashCommissionRate: 0.25,
  uberPickupCommissionRate: 0.1,
  doordashPickupCommissionRate: 0.06,
  grubhubCommissionRate: null,
}
const rates = new Map([["s1", RATES]])

const DAY = "2026-10-13"

function recorded(orders: number, fee: number, ticket: number, over: Partial<OrderFeeGroup> = {}): OrderFeeGroup {
  return { storeId: "s1", day: DAY, platform: "doordash", mode: "delivery", recorded: true, orders, fee, ticket, ...over }
}

function slice(over: Partial<SalesSlice> = {}): SalesSlice {
  return { storeId: "s1", day: DAY, platform: "doordash", orders: 100, net: 2_000, ...over }
}

describe("order rows checked against the daily summary", () => {
  it("trusts the rows when they cover at least 90% of the summary's orders", () => {
    expect(ORDER_ROW_COVERAGE_FLOOR).toBe(0.9)
    const t = totalCommission([recorded(90, 450, 1_800)], rates, undefined, [slice()])
    expect(t.amount).toBe(450)
    expect(t.ordersFromSales).toBe(0)
    expect(commissionIsEstimated(t)).toBe(false)
    expect(commissionBasis(t)).toBe("as recorded by the marketplaces")
  })

  it("prices the slice off its sales at the DELIVERY rate when rows cover less than 90%", () => {
    const t = totalCommission([recorded(89, 445, 1_780)], rates, undefined, [slice()])
    // 25% DoorDash delivery × $2,000 — the 89 rows' recorded $445 is replaced, not added.
    expect(t.amount).toBeCloseTo(500)
    expect(t.recorded).toBe(0)
    expect(t.orders).toBe(100)
    expect(t.ordersFromSales).toBe(100)
    expect(commissionIsEstimated(t)).toBe(true)
    expect(commissionBasis(t)).toContain("100 from daily sales, order detail missing")
  })

  it("prices a day with no order rows at all (before OtterOrder history began)", () => {
    const old = slice({ day: "2025-03-01", orders: 40, net: 1_000 })
    const t = totalCommission([], rates, undefined, [old])
    expect(t.amount).toBeCloseTo(250)
    expect(t.ordersEstimated).toBe(40)
  })

  it("never prints $0 for a channel that sold with no rate on file — it is unknown", () => {
    const gh = slice({ platform: "grubhub", orders: 12, net: 300 })
    const t = totalCommission([], rates, undefined, [gh])
    expect(t.amount).toBeNull()
    expect(t.unknownOrders).toBe(12)
    expect(commissionIsEstimated(t)).toBe(true)
  })

  it("leaves house platforms and zero-order slices alone", () => {
    const t = totalCommission(
      [],
      rates,
      undefined,
      [slice({ platform: "css-pos", orders: 300, net: 9_000 }), slice({ orders: 0, net: 0 })],
    )
    expect(t.amount).toBe(0)
    expect(t.orders).toBe(0)
  })

  it("buckets reconciled slices into their periods and lines", () => {
    const d1 = new Date(Date.UTC(2026, 9, 13))
    const d2 = new Date(Date.UTC(2026, 9, 14))
    const periods = buildPeriods(d1, d2, "daily")
    const groups = [recorded(100, 480, 1_900), recorded(5, 20, 100, { day: "2026-10-14" })]
    const slices = [slice(), slice({ day: "2026-10-14", orders: 50, net: 1_200 })]
    const [a, b] = bucketCommission(groups, periods, rates, slices)
    expect(a.doordash.amount).toBe(480)
    expect(a.doordash.ordersFromSales).toBe(0)
    expect(b.doordash.amount).toBeCloseTo(300)
    expect(b.doordash.ordersFromSales).toBe(50)
  })

  it("without slices it is the per-order rule alone (the orders page)", () => {
    const t = totalCommission([recorded(10, 50, 200)], rates)
    expect(t.amount).toBe(50)
  })
})

describe("summary rows into slices", () => {
  const row = (over: Partial<OtterSummaryRow> & { storeId?: string; date?: Date; tpOrderCount?: number }) => ({
    storeId: "s1",
    date: new Date(Date.UTC(2026, 9, 13)),
    platform: "doordash",
    paymentMethod: "CARD",
    fpGrossSales: null,
    tpGrossSales: null,
    fpTaxCollected: null,
    tpTaxCollected: null,
    fpDiscounts: null,
    tpDiscounts: null,
    fpServiceCharges: null,
    tpServiceCharges: null,
    tpRefundsAdjustments: null,
    tpOrderCount: 0,
    ...over,
  })

  it("folds payment methods, nets discounts and refunds, leaves out tax and service charges", () => {
    const out = summarySlices([
      row({ tpGrossSales: 1_000, tpDiscounts: -100, tpRefundsAdjustments: -20, tpTaxCollected: 95, tpServiceCharges: 30, tpOrderCount: 30 }),
      row({ paymentMethod: "PREPAID", tpGrossSales: 500, tpOrderCount: 10 }),
      row({ platform: "css-pos", fpGrossSales: 4_000 }),
    ])
    expect(out).toEqual([{ storeId: "s1", day: "2026-10-13", platform: "doordash", orders: 40, net: 1_380 }])
  })

  it("keys a day by its UTC calendar date, matching OrderFeeGroup.day", () => {
    const [s] = salesSlices([
      { storeId: "s1", date: new Date(Date.UTC(2026, 9, 19)), platform: "ubereats", orders: 3, net: 60 },
    ])
    expect(s.day).toBe("2026-10-19")
  })
})

describe("the commission rate an owner types — one unit, percents", () => {
  it("reads percents as percents: 25 is 25%, 6.1 is 6.1%", () => {
    expect(parseRatePercent("25", "DoorDash delivery", { required: true })).toEqual({ ok: true, value: 25 })
    expect(parseRatePercent(" 6.1% ", "DoorDash pickup", { required: false })).toEqual({ ok: true, value: 6.1 })
    expect(parseRatePercent("1", "Grubhub", { required: false })).toEqual({ ok: true, value: 1 })
    expect(percentToFraction(6.1)).toBe(0.061)
    expect(percentToFraction(25)).toBe(0.25)
  })

  it("rejects 150 rather than saving it as 1.5%", () => {
    const r = parseRatePercent("150", "Uber Eats delivery", { required: true })
    expect(r).toEqual({ ok: false, error: "Uber Eats delivery must be between 0% and 100%" })
  })

  it("rejects non-numeric and negative values with a message, never silently", () => {
    expect(parseRatePercent("abc", "Grubhub", { required: false }).ok).toBe(false)
    expect(parseRatePercent("2O", "Grubhub", { required: false }).ok).toBe(false)
    expect(parseRatePercent("-5", "Uber Eats pickup", { required: false }).ok).toBe(false)
  })

  it("blank clears an optional rate and is an error on a required one", () => {
    expect(parseRatePercent("  ", "Grubhub", { required: false })).toEqual({ ok: true, value: null })
    expect(parseRatePercent("", "DoorDash delivery", { required: true }).ok).toBe(false)
  })
})
