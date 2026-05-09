import { describe, expect, it } from "vitest"
import {
  aggregateChannelTotals,
  type ChannelSummaryRow,
} from "@/lib/otter-analytics-aggregation"

function row(overrides: Partial<ChannelSummaryRow> = {}): ChannelSummaryRow {
  return {
    platform: "css-pos",
    paymentMethod: "CASH",
    fpGrossSales: 100,
    fpNetSales: 90,
    fpFees: 5,
    fpDiscounts: 2,
    fpTaxCollected: 8,
    fpTaxRemitted: 8,
    fpTips: 1,
    fpServiceCharges: 0,
    fpLoyalty: 0,
    fpOrderCount: 1,
    tpGrossSales: 0,
    tpNetSales: 0,
    tpFees: 0,
    tpDiscounts: 0,
    tpTaxCollected: 0,
    tpTaxRemitted: 0,
    tpTipForRestaurant: 0,
    tpServiceCharges: 0,
    tpLoyaltyDiscount: 0,
    tpRefundsAdjustments: 0,
    tpOrderCount: 0,
    tillPaidIn: 0,
    tillPaidOut: 0,
    ...overrides,
  }
}

describe("aggregateChannelTotals", () => {
  it("returns an empty Map for empty input", () => {
    expect(aggregateChannelTotals([]).size).toBe(0)
  })

  it("groups FP rows by (platform, paymentMethod) and sums FP fields only", () => {
    const result = aggregateChannelTotals([
      row({ platform: "css-pos", paymentMethod: "CASH", fpGrossSales: 100, fpFees: 5 }),
      row({ platform: "css-pos", paymentMethod: "CASH", fpGrossSales: 50, fpFees: 3 }),
    ])
    const entry = result.get("css-pos|||CASH")
    expect(entry).toBeDefined()
    expect(entry!.platform).toBe("css-pos")
    expect(entry!.paymentMethod).toBe("CASH")
    expect(entry!.grossSales).toBe(150)
    expect(entry!.fees).toBe(8)
    expect(entry!.orderCount).toBe(2) // two rows with fpOrderCount: 1 each
  })

  it("splits FP CASH and CARD into distinct channels", () => {
    const result = aggregateChannelTotals([
      row({ paymentMethod: "CASH", fpGrossSales: 100 }),
      row({ paymentMethod: "CARD", fpGrossSales: 200 }),
    ])
    expect(result.size).toBe(2)
    expect(result.get("css-pos|||CASH")!.grossSales).toBe(100)
    expect(result.get("css-pos|||CARD")!.grossSales).toBe(200)
  })

  it("3P platforms key by platform only with paymentMethod=null and use TP fields", () => {
    const result = aggregateChannelTotals([
      row({
        platform: "doordash",
        paymentMethod: null,
        fpGrossSales: 0,
        fpNetSales: 0,
        fpFees: 0,
        fpOrderCount: 0,
        tpGrossSales: 250,
        tpNetSales: 220,
        tpFees: 30,
        tpOrderCount: 3,
        tpRefundsAdjustments: 4,
      }),
    ])
    expect(result.size).toBe(1)
    const entry = result.get("doordash|||")
    expect(entry).toBeDefined()
    expect(entry!.paymentMethod).toBeNull()
    expect(entry!.grossSales).toBe(250)
    expect(entry!.netSales).toBe(220)
    expect(entry!.fees).toBe(30)
    expect(entry!.orderCount).toBe(3)
    expect(entry!.refundsAdjustments).toBe(4)
  })

  it("treats FP paymentMethod 'N/A' as null and groups it into a paymentMethod=null channel", () => {
    const result = aggregateChannelTotals([
      row({ platform: "css-pos", paymentMethod: "N/A", fpGrossSales: 75 }),
    ])
    const entry = result.get("css-pos|||")
    expect(entry).toBeDefined()
    expect(entry!.paymentMethod).toBeNull()
    expect(entry!.grossSales).toBe(75)
  })

  it("computes theoreticalDeposit and expectedDeposit per channel", () => {
    const result = aggregateChannelTotals([
      row({
        platform: "css-pos",
        paymentMethod: "CASH",
        fpGrossSales: 100,
        fpNetSales: 90,
        fpFees: 4,
        fpTaxCollected: 8,
        fpTaxRemitted: -8, // signed
        fpTips: 1,
        fpServiceCharges: 0,
        tillPaidIn: 5,
        tillPaidOut: 2,
      }),
    ])
    const entry = result.get("css-pos|||CASH")!
    // theoretical = net + tax_collected - |tax_remitted| + tips + serviceCharges - |fees|
    // = 90 + 8 - 8 + 1 + 0 - 4 = 87
    expect(entry.theoreticalDeposit).toBe(87)
    // expected = theoretical + paidIn - |paidOut| = 87 + 5 - 2 = 90
    expect(entry.expectedDeposit).toBe(90)
  })

  it("isolates till totals per channel (paidIn / paidOut sum independently)", () => {
    const result = aggregateChannelTotals([
      row({ platform: "css-pos", paymentMethod: "CASH", tillPaidIn: 10, tillPaidOut: 0 }),
      row({ platform: "css-pos", paymentMethod: "CASH", tillPaidIn: 5, tillPaidOut: 3 }),
    ])
    const entry = result.get("css-pos|||CASH")!
    expect(entry.paidIn).toBe(15)
    expect(entry.paidOut).toBe(3)
  })

  it("handles multiple distinct channels in a single pass", () => {
    const result = aggregateChannelTotals([
      row({ platform: "css-pos", paymentMethod: "CASH", fpGrossSales: 100 }),
      row({
        platform: "doordash",
        paymentMethod: null,
        fpGrossSales: 0,
        fpNetSales: 0,
        fpOrderCount: 0,
        tpGrossSales: 200,
      }),
      row({ platform: "ubereats", paymentMethod: null, fpGrossSales: 0, tpGrossSales: 150 }),
    ])
    expect(result.size).toBe(3)
    expect(result.get("css-pos|||CASH")!.grossSales).toBe(100)
    expect(result.get("doordash|||")!.grossSales).toBe(200)
    expect(result.get("ubereats|||")!.grossSales).toBe(150)
  })
})
