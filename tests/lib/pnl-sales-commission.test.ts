// One sales definition and one commission function (2026-10-28).
//
// Measured on production for the last 30 days: Otter's gross EXCLUDES tax
// (gross + discounts + tpRefundsAdjustments reconciles to Otter's net to the
// dollar), recorded per-order commission is charged on the DISCOUNTED ticket,
// and only 50–75% of marketplace orders carry one. These tests pin the
// statement and the commission rule to those facts.

import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: { $queryRaw: vi.fn(async () => []) } }))

import { prisma } from "@/lib/prisma"
import {
  buildPeriods,
  computeStorePnL,
  rowSales,
  salesRowValues,
  GL_ROWS,
  DISCOUNTS_CODE,
  GROSS_SALES_CODE,
  GRUBHUB_COMMISSION_CODE,
  OTHER_COMMISSION_CODE,
  REFUNDS_CODE,
  TAX_MEMO_CODE,
  TOTAL_SALES_CODE,
  UBER_COMMISSION_CODE,
  DOORDASH_COMMISSION_CODE,
  type OtterSummaryRow,
} from "@/lib/pnl"
import {
  bucketCommission,
  COMMISSION_FREE_PLATFORMS,
  storeRateFor,
  totalCommission,
  type OrderFeeGroup,
} from "@/lib/counter/commission-core"
import { loadOrderFeeGroups } from "@/lib/counter/commission"
import { HOUSE_PLATFORMS } from "@/lib/counter/channel-mix"

const day = new Date(Date.UTC(2026, 9, 1))
const periods = buildPeriods(day, day, "daily")

function summary(over: Partial<OtterSummaryRow>): OtterSummaryRow {
  return {
    platform: "css-pos",
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
    ...over,
  }
}

const STORE = {
  id: "s1",
  fixedMonthlyLabor: null,
  fixedMonthlyRent: null,
  fixedMonthlyTowels: null,
  fixedMonthlyCleaning: null,
  uberCommissionRate: 0.27,
  doordashCommissionRate: 0.25,
  uberPickupCommissionRate: 0.1,
  doordashPickupCommissionRate: 0.06,
  grubhubCommissionRate: null as number | null,
}

const rowOf = (rows: ReturnType<typeof computeStorePnL>["rows"], code: string) =>
  rows.find((r) => r.code === code)

function group(g: Partial<OrderFeeGroup> & { platform: string; ticket: number }): OrderFeeGroup {
  return { storeId: "s1", day: "2026-10-01", mode: "delivery", recorded: false, orders: 10, fee: 0, ...g }
}

describe("one sales definition", () => {
  // Hollywood DoorDash, 30 days to 2026-10-28: 72,088 − 18,371 − 482 = 53,235.
  const doordash = summary({
    platform: "doordash",
    paymentMethod: "OFO",
    tpGrossSales: 72_088,
    tpDiscounts: -18_371,
    tpRefundsAdjustments: -482,
    tpTaxCollected: 6_100,
  })
  const house = summary({ fpGrossSales: 67_678, fpDiscounts: -1_000, fpTaxCollected: 6_599 })

  it("does NOT subtract sales tax from Total Sales", () => {
    const c = computeStorePnL({ bucketed: [[house, doordash]], periods, store: STORE })
    // 67,678 − 1,000 + 72,088 − 18,371 − 482. Tax is not in it.
    expect(c.totalSales[0]).toBeCloseTo(119_913)
    expect(rowOf(c.rows, TOTAL_SALES_CODE)?.label).toBe("Net Sales")
    // Tax stays visible, as a memo the totals never add.
    const tax = rowOf(c.rows, TAX_MEMO_CODE)
    expect(tax?.values[0]).toBeCloseTo(12_699)
    expect(tax?.isMemo).toBe(true)
  })

  it("subtracts refunds and discounts on their own lines, under gross", () => {
    const c = computeStorePnL({ bucketed: [[doordash]], periods, store: STORE })
    expect(rowOf(c.rows, GROSS_SALES_CODE)?.values[0]).toBe(72_088)
    expect(rowOf(c.rows, DISCOUNTS_CODE)?.values[0]).toBe(-18_371)
    expect(rowOf(c.rows, REFUNDS_CODE)?.values[0]).toBe(-482)
    expect(c.totalSales[0]).toBe(53_235)
    // Otter's own net for the same row: the statement now agrees with it.
    expect(rowSales(doordash).net).toBe(53_235)
  })

  it("sums its GL lines to Total Sales, so nothing that totals them can disagree", () => {
    const vals = salesRowValues([house, doordash])
    expect(vals).toHaveLength(GL_ROWS.length)
    expect(vals.reduce((a, b) => a + b, 0)).toBeCloseTo(119_913)
  })

  it("counts PREPAID on css-pos on its own line instead of dropping it", () => {
    const prepaid = summary({ paymentMethod: "PREPAID", fpGrossSales: 700 })
    const vals = salesRowValues([prepaid])
    const idx = GL_ROWS.findIndex((r) => r.code === "4018P")
    expect(vals[idx]).toBe(700)
    expect(vals.reduce((a, b) => a + b, 0)).toBe(700)
  })
})

describe("one commission function", () => {
  const rates = new Map([["s1", STORE]])

  it("charges the estimate on the DISCOUNTED ticket", () => {
    // ticket = Σ max(0, subtotal + discount), as the SQL builds it.
    const t = totalCommission([group({ platform: "doordash", ticket: 37.47, orders: 1 })], rates)
    expect(t.amount).toBeCloseTo(0.25 * 37.47)
  })

  it("lets a recorded fee beat the estimate", () => {
    const t = totalCommission(
      [group({ platform: "ubereats", ticket: 1000, orders: 40, recorded: true, fee: 120 })],
      rates,
    )
    // 12% recorded, not 27% estimated.
    expect(t.amount).toBe(120)
    expect(t.ordersEstimated).toBe(0)
  })

  it("prices pickup at the pickup rate", () => {
    expect(storeRateFor(STORE, "doordash", "pickup")).toBe(0.06)
    const t = totalCommission([group({ platform: "doordash", mode: "pickup", ticket: 1000 })], rates)
    expect(t.amount).toBeCloseTo(60)
  })

  it("leaves a platform with no rate and nothing recorded NULL, never 0", () => {
    const t = totalCommission([group({ platform: "grubhub", ticket: 500, orders: 5 })], rates)
    expect(t.amount).toBeNull()
    expect(t.unknownOrders).toBe(5)

    const c = computeStorePnL({
      bucketed: [[summary({ platform: "grubhub", paymentMethod: "OFO", tpGrossSales: 500 })]],
      periods,
      store: STORE,
      commission: bucketCommission([group({ platform: "grubhub", ticket: 500, orders: 5 })], periods, rates),
    })
    const gh = rowOf(c.rows, GRUBHUB_COMMISSION_CODE)
    expect(gh?.values[0]).toBe(-0)
    expect(gh?.isUnknown?.[0]).toBe(true)
  })

  it("puts commission on the P&L lines from the order groups, by business day", () => {
    const c = computeStorePnL({
      bucketed: [[summary({ platform: "ubereats", paymentMethod: "OFO", tpGrossSales: 1000, tpDiscounts: -100 })]],
      periods,
      store: STORE,
      commission: bucketCommission(
        [
          group({ platform: "ubereats", ticket: 500, orders: 20, recorded: true, fee: 130 }),
          group({ platform: "ubereats", ticket: 400, orders: 16 }),
          // The next day: not in this period.
          group({ platform: "ubereats", ticket: 9_999, day: "2026-10-02" }),
        ],
        periods,
        rates,
      ),
    })
    expect(rowOf(c.rows, UBER_COMMISSION_CODE)?.label).toBe("Uber Eats commission")
    expect(c.uberCommission[0]).toBeCloseTo(-(130 + 0.27 * 400))
    expect(c.netAfterCommissions[0]).toBeCloseTo(900 - 130 - 108)
    expect(c.commission[0].ubereats.ordersEstimated).toBe(16)
  })

  it("flags marketplace sales with no orders on file rather than charging $0", () => {
    const c = computeStorePnL({
      bucketed: [[summary({ platform: "doordash", paymentMethod: "OFO", tpGrossSales: 1000 })]],
      periods,
      store: STORE,
      commission: bucketCommission([], periods, rates),
    })
    expect(rowOf(c.rows, DOORDASH_COMMISSION_CODE)?.isUnknown?.[0]).toBe(true)
  })

  it("falls back to the store's delivery rate on after-discount sales with no order rows passed", () => {
    const c = computeStorePnL({
      bucketed: [[summary({ platform: "doordash", paymentMethod: "OFO", tpGrossSales: 1000, tpDiscounts: -200 })]],
      periods,
      store: STORE,
    })
    expect(c.doordashCommission[0]).toBeCloseTo(-200)
    // ChowNow traded nothing, so it has no line.
    expect(rowOf(c.rows, OTHER_COMMISSION_CODE)).toBeUndefined()
  })

  it("excludes cancelled and in-house orders, and filters by the account, in SQL", async () => {
    await loadOrderFeeGroups({ accountId: "acct-A", storeIds: ["s1"], startDate: day, endDate: day })
    const sql = vi.mocked(prisma.$queryRaw).mock.calls[0][0] as unknown as { strings: string[]; values: unknown[] }
    const text = sql.strings.join("?")
    expect(text).toContain("OFO_STATUS_CANCELED")
    expect(text).toContain(`s."accountId" =`)
    expect(sql.values).toContain("acct-A")
    expect(sql.values).toEqual(expect.arrayContaining(["css-pos", "bnm-web"]))
  })

  it("agrees with channel-mix about which platforms are in-house", () => {
    expect([...COMMISSION_FREE_PLATFORMS].sort()).toEqual([...HOUSE_PLATFORMS].sort())
  })
})
