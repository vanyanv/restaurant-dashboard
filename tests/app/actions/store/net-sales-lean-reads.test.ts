// getNetSalesByPeriod / getSalesAndCogsRow read only what they print. They must
// return exactly the figures the whole statement (getAllStoresPnL) holds for
// the same rows: the Net Sales row, per store and consolidated, and the COGS row.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(async () => ({ user: { id: "u1", accountId: "acct-A", role: "OWNER" } })),
}))
vi.mock("@/lib/auth", () => ({ authOptions: {}, hasOwnerAccess: () => true }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    store: { findMany: vi.fn() },
    otterDailySummary: { findMany: vi.fn() },
    dailyCogsItem: { findMany: vi.fn() },
    storeFixedExpense: { findMany: vi.fn() },
  },
}))
vi.mock("@/lib/cache/cached", async (orig) => ({
  ...(await orig<typeof import("@/lib/cache/cached")>()),
  cached: vi.fn(async (_k: string, _t: number, _tags: string[], fn: () => unknown) => fn()),
}))
vi.mock("@/lib/counter/commission", async (orig) => ({
  ...(await orig<typeof import("@/lib/counter/commission")>()),
  loadOrderFeeGroups: vi.fn(async () => []),
}))
vi.mock("@/lib/counter/labor-cost", async (orig) => ({
  ...(await orig<typeof import("@/lib/counter/labor-cost")>()),
  loadLaborCost: vi.fn(async () => ({ stores: {}, total: 0, missingStoreDays: 0 })),
}))

import { prisma } from "@/lib/prisma"
import { COGS_CODE, TOTAL_SALES_CODE } from "@/lib/pnl"
import {
  getAllStoresPnL,
  getNetSalesByPeriod,
  getSalesAndCogsRow,
} from "@/app/actions/store/pnl-actions"

const store = (id: string, name: string) => ({
  id,
  name,
  accountId: "acct-A",
  isActive: true,
  fixedMonthlyLabor: null,
  fixedMonthlyRent: null,
  fixedMonthlyTowels: null,
  fixedMonthlyCleaning: null,
  uberCommissionRate: 0.2,
  doordashCommissionRate: 0.2,
  employerPayrollTaxRate: 0,
})

const summary = (storeId: string, day: string, platform: string, gross: number, disc = 0) => ({
  storeId,
  date: new Date(`${day}T00:00:00.000Z`),
  platform,
  paymentMethod: "CARD",
  fpGrossSales: platform === "ONLINE" ? gross : 0,
  tpGrossSales: platform === "ONLINE" ? 0 : gross,
  fpTaxCollected: 1.11,
  tpTaxCollected: 0.37,
  fpDiscounts: -disc,
  tpDiscounts: 0,
  fpServiceCharges: 0.1,
  tpServiceCharges: 0.2,
  tpRefundsAdjustments: -0.3,
  tpOrderCount: 2,
})

const cogs = (storeId: string, day: string, lineCost: number, revenue: number) => ({
  storeId,
  date: new Date(`${day}T00:00:00.000Z`),
  itemName: "Burger",
  category: "Mains",
  qtySold: 3,
  salesRevenue: revenue,
  lineCost,
  status: "COSTED",
  recipeId: "r1",
  partialCost: false,
})

const startDate = new Date("2026-11-02T00:00:00.000Z")
const endDate = new Date("2026-11-08T00:00:00.000Z")

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.store.findMany).mockResolvedValue([store("s1", "A"), store("s2", "B")] as never)
  vi.mocked(prisma.storeFixedExpense.findMany).mockResolvedValue([] as never)
  const days = ["2026-11-02", "2026-11-03", "2026-11-05", "2026-11-08"]
  vi.mocked(prisma.otterDailySummary.findMany).mockResolvedValue(
    days.flatMap((d, i) => [
      summary("s1", d, "ONLINE", 1234.57 + i * 0.13, 12.3),
      summary("s1", d, "UBEREATS", 301.11 + i * 0.07),
      summary("s2", d, "DOORDASH", 777.77 + i * 0.29, 5.5),
    ]) as never,
  )
  vi.mocked(prisma.dailyCogsItem.findMany).mockResolvedValue(
    days.flatMap((d, i) => [cogs("s1", d, 301.17 + i, 900), cogs("s2", d, 133.33 + i * 0.1, 400)]) as never,
  )
})

async function statement() {
  const res = await getAllStoresPnL({ startDate, endDate, granularity: "daily" })
  if ("error" in res) throw new Error(res.error)
  return res
}
const row = (rows: Array<{ code: string; values: number[] }>, code: string) =>
  rows.find((r) => r.code === code)?.values ?? []

describe("getNetSalesByPeriod", () => {
  it("returns the statement's Net Sales row, per store and consolidated, bit for bit", async () => {
    const full = await statement()
    const lean = await getNetSalesByPeriod({ startDate, endDate, granularity: "daily" })
    if ("error" in lean) throw new Error(lean.error)
    expect(lean.periods).toEqual(full.periods)
    expect(lean.combined).toEqual(row(full.consolidatedRows, TOTAL_SALES_CODE))
    expect(lean.perStore.map((s) => s.storeId)).toEqual(full.perStore.map((s) => s.storeId))
    for (const [i, s] of lean.perStore.entries()) {
      expect(s.net).toEqual(row(full.perStore[i].rows, TOTAL_SALES_CODE))
    }
  })

  it("reads only the daily summaries, scoped to the account", async () => {
    vi.mocked(prisma.otterDailySummary.findMany).mockClear()
    vi.mocked(prisma.dailyCogsItem.findMany).mockClear()
    await getNetSalesByPeriod({ startDate, endDate, granularity: "daily" })
    expect(prisma.otterDailySummary.findMany).toHaveBeenCalledTimes(1)
    expect(vi.mocked(prisma.otterDailySummary.findMany).mock.calls[0][0]?.where).toMatchObject({
      store: { accountId: "acct-A" },
    })
    expect(prisma.dailyCogsItem.findMany).not.toHaveBeenCalled()
    expect(prisma.storeFixedExpense.findMany).not.toHaveBeenCalled()
  })

  it("gives nothing for an account with no stores, as the statement does", async () => {
    vi.mocked(prisma.store.findMany).mockResolvedValue([] as never)
    const full = await statement()
    const lean = await getNetSalesByPeriod({ startDate, endDate, granularity: "daily" })
    if ("error" in lean) throw new Error(lean.error)
    expect(lean.combined).toEqual(row(full.consolidatedRows, TOTAL_SALES_CODE))
    expect(lean.perStore).toEqual([])
  })
})

describe("getSalesAndCogsRow", () => {
  it("equals the statement's grossSales and COGS row for every store", async () => {
    const full = await statement()
    const lean = await getSalesAndCogsRow({ startDate, endDate, storeId: null })
    if ("error" in lean) throw new Error(lean.error)
    expect(lean.totalSales).toBe(full.combined.grossSales)
    expect(lean.cogsRow).toEqual(row(full.consolidatedRows, COGS_CODE))
    // The caller's own flip, as menu profit does it.
    const sum = (xs: number[]) => xs.reduce((t, v) => t + v, 0)
    expect(-sum(lean.cogsRow)).toBe(-sum(row(full.consolidatedRows, COGS_CODE)))
  })

  it("equals the statement's figures for one store, reading only that store", async () => {
    const full = await statement()
    vi.mocked(prisma.otterDailySummary.findMany).mockClear()
    const lean = await getSalesAndCogsRow({ startDate, endDate, storeId: "s2" })
    if ("error" in lean) throw new Error(lean.error)
    const mine = full.perStore.find((s) => s.storeId === "s2")!
    expect(lean.totalSales).toBe(mine.grossSales)
    expect(lean.cogsRow).toEqual(row(mine.rows, COGS_CODE))
    expect(vi.mocked(prisma.otterDailySummary.findMany).mock.calls[0][0]?.where).toMatchObject({
      storeId: { in: ["s2"] },
      store: { accountId: "acct-A" },
    })
  })

  it("is zero for a store the account does not have", async () => {
    const lean = await getSalesAndCogsRow({ startDate, endDate, storeId: "other-account-store" })
    expect(lean).toEqual({ totalSales: 0, cogsRow: [] })
  })
})
