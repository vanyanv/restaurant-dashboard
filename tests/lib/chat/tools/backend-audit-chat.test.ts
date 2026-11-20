/*
 * The chat tools fixed by the 2026-11-20 backend audit:
 *
 * - store / platform breakdowns compute gross and net with the P&L's own
 *   `rowSales`, not Otter's fpNetSales + tpNetSales;
 * - getOperationalCosts reports the P&L's fixed costs (expense lines included)
 *   and every commission rate the settings page holds;
 * - a store-scoped question no longer gets "All stores" P&L snapshots or
 *   unassigned invoices;
 * - refunds sort by size (they are negative);
 * - ingredient prices read the last invoice for all ingredients in one query.
 */
import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/chat/owner-scope", () => ({
  assertOwnerOwnsStores: vi.fn(async (_a: string, req: string[] | null) => req ?? ["s1", "s2"]),
}))
vi.mock("@/lib/chat/embeddings", () => ({
  embed: vi.fn(async () => [0.1, 0.2]),
  toVectorLiteral: (v: number[]) => `[${v.join(",")}]`,
}))

import { getStoreBreakdown, getOperationalCosts } from "@/lib/chat/tools/store-summary"
import { getPlatformBreakdown } from "@/lib/chat/tools/platforms"
import { getRefunds } from "@/lib/chat/tools/refunds"
import { searchPnlHistory } from "@/lib/chat/tools/pnl-history"
import { searchInvoices, getTopInvoices } from "@/lib/chat/tools/invoices"
import { getIngredientPrices } from "@/lib/chat/tools/ingredients"
import { embed } from "@/lib/chat/embeddings"
import { rowSales } from "@/lib/pnl"
import type { ChatToolContext } from "@/lib/chat/tools/types"

const dateRange = { from: "2026-11-01", to: "2026-11-07" }

function ctxWith(prisma: Record<string, unknown>): ChatToolContext {
  return { ownerId: "u1", accountId: "acct-A", prisma: prisma as unknown as ChatToolContext["prisma"] }
}

/** One summary group as Prisma's `groupBy` returns it. */
function sum(platform: string, storeId: string, s: Record<string, number>) {
  return {
    platform,
    storeId,
    _sum: {
      fpGrossSales: 0,
      tpGrossSales: 0,
      fpServiceCharges: 0,
      tpServiceCharges: 0,
      fpDiscounts: 0,
      tpDiscounts: 0,
      tpRefundsAdjustments: 0,
      fpOrderCount: 0,
      tpOrderCount: 0,
      // Otter's own net columns: deliberately wrong, so reading them fails.
      fpNetSales: 99999,
      tpNetSales: 99999,
      ...s,
    },
  }
}

describe("sales breakdowns use the P&L's rowSales", () => {
  // css-pos: $1,000 gross, −$50 discounts, $20 service charges → net $970.
  // doordash: $500 gross, −$25 discounts, −$10 refunds → net $465. A stray
  // fp gross on a marketplace row is not the marketplace's sale.
  const groups = [
    sum("css-pos", "s1", { fpGrossSales: 1000, fpDiscounts: -50, fpServiceCharges: 20, fpOrderCount: 40 }),
    sum("doordash", "s1", { tpGrossSales: 500, fpGrossSales: 7, tpDiscounts: -25, tpRefundsAdjustments: -10, tpOrderCount: 20 }),
  ]

  it("getPlatformBreakdown", async () => {
    const rows = await getPlatformBreakdown.execute(
      { dateRange },
      ctxWith({ otterDailySummary: { groupBy: vi.fn(async () => groups) } }),
    )
    const by = Object.fromEntries(rows.map((r) => [r.platform, r]))
    expect(by["css-pos"].gross).toBe(1000)
    expect(by["css-pos"].net).toBe(970)
    expect(by["doordash"].gross).toBe(500)
    expect(by["doordash"].net).toBe(465)
    // The statement's own figure, for the same rows.
    expect(by["doordash"].net).toBe(rowSales({ ...groups[1]._sum, platform: "doordash", fpTaxCollected: null, tpTaxCollected: null }).net)
  })

  it("getStoreBreakdown", async () => {
    const rows = await getStoreBreakdown.execute(
      { storeIds: ["s1"], dateRange },
      ctxWith({
        otterDailySummary: { groupBy: vi.fn(async () => groups) },
        store: { findMany: vi.fn(async () => [{ id: "s1", name: "Hollywood" }]) },
      }),
    )
    expect(rows[0].gross).toBe(1500)
    expect(rows[0].net).toBe(1435)
    expect(rows[0].count).toBe(60)
  })
})

describe("getOperationalCosts matches store settings and the P&L", () => {
  it("adds fixed-expense lines at their monthly equivalent, lists missing inputs and every rate", async () => {
    const findMany = vi.fn(async () => [
      {
        id: "s1",
        name: "Hollywood",
        fixedMonthlyLabor: null,
        fixedMonthlyRent: 5000,
        fixedMonthlyTowels: 100,
        fixedMonthlyCleaning: null,
        uberCommissionRate: 0.27,
        doordashCommissionRate: 0.25,
        uberPickupCommissionRate: 0.06,
        doordashPickupCommissionRate: null,
        grubhubCommissionRate: 0.2,
        targetCogsPct: 28,
        fixedExpenses: [
          { label: "Insurance", amount: 1200, frequency: "YEARLY" },
          { label: "Pest control", amount: 60, frequency: "WEEKLY" },
        ],
      },
    ])
    const [row] = await getOperationalCosts.execute({}, ctxWith({ store: { findMany } }))
    // 5000 + 100 + 1200/12 + 60*52/12
    expect(row.totalFixedMonthly).toBeCloseTo(5000 + 100 + 100 + 260, 6)
    expect(row.otherFixedExpenses.map((l) => l.monthly)).toEqual([100, 260])
    expect(row.missingFixedInputs).toEqual(["salariedLabor", "cleaning"])
    expect(row.uberPickupCommissionRate).toBe(0.06)
    expect(row.doordashPickupCommissionRate).toBeNull()
    expect(row.grubhubCommissionRate).toBe(0.2)
    const where = (findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where
    expect(where.accountId).toBe("acct-A")
  })
})

describe("getRefunds sorts by size", () => {
  it("puts the largest refund first even though refunds are negative", async () => {
    const rows = await getRefunds.execute(
      { dateRange, groupBy: "platform" },
      ctxWith({
        otterDailySummary: {
          groupBy: vi.fn(async () => [
            { platform: "ubereats", _sum: { tpRefundsAdjustments: -12 } },
            { platform: "doordash", _sum: { tpRefundsAdjustments: -340 } },
            { platform: "grubhub", _sum: { tpRefundsAdjustments: -55 } },
          ]),
        },
      }),
    )
    expect(rows.map((r) => r.platform)).toEqual(["doordash", "grubhub", "ubereats"])
  })
})

describe("store-scoped questions get only that store's rows", () => {
  it("searchPnlHistory excludes the All-stores snapshots when stores are named", async () => {
    const q = vi.fn(async () => [])
    const ctx = ctxWith({ $queryRawUnsafe: q })
    await searchPnlHistory.execute({ query: "worst week", storeIds: ["s1"], limit: 5 }, ctx)
    await searchPnlHistory.execute({ query: "worst week", limit: 5 }, ctx)
    const calls = q.mock.calls as unknown as unknown[][]
    expect(calls[0][0]).toContain('$5::boolean = false AND e."storeId" IS NULL')
    expect(calls[0][5]).toBe(true)
    expect(calls[1][5]).toBe(false)
    // And the embedding is billed to the asker.
    expect(vi.mocked(embed).mock.calls[0][1]).toEqual({ feature: "chat-search", userId: "u1" })
  })

  it("searchInvoices excludes unassigned invoices when stores are named", async () => {
    const q = vi.fn(async () => [])
    const ctx = ctxWith({ $queryRawUnsafe: q })
    await searchInvoices.execute({ query: "beef", storeIds: ["s1"], limit: 10 }, ctx)
    await searchInvoices.execute({ query: "beef", limit: 10 }, ctx)
    const calls = q.mock.calls as unknown as unknown[][]
    expect(calls[0][7]).toBe(true)
    expect(calls[1][7]).toBe(false)
  })

  it("getTopInvoices drops storeId: null from a store-scoped where", async () => {
    const findMany = vi.fn(async () => [])
    const ctx = ctxWith({ invoice: { findMany } })
    await getTopInvoices.execute({ storeIds: ["s1"], dateRange, topN: 10 }, ctx)
    await getTopInvoices.execute({ dateRange, topN: 10 }, ctx)
    const wheres = (findMany.mock.calls as unknown as Array<[{ where: { OR: unknown[] } }]>).map((c) => c[0].where.OR)
    expect(wheres[0]).toEqual([{ storeId: { in: ["s1"] } }])
    expect(wheres[1]).toEqual([{ storeId: null }, { storeId: { in: ["s1", "s2"] } }])
  })
})

describe("getIngredientPrices", () => {
  it("reads the last invoice for every ingredient in one query, not one per ingredient", async () => {
    const queryRaw = vi.fn(async () => [
      { canonicalIngredientId: "c1", vendorName: "Sysco", invoiceDate: new Date("2026-11-03T00:00:00Z") },
    ])
    const findFirst = vi.fn()
    const rows = await getIngredientPrices.execute(
      { query: "beef", limit: 10 },
      ctxWith({
        canonicalIngredient: {
          findMany: vi.fn(async () => [
            { id: "c1", name: "Ground beef", defaultUnit: "lb", recipeUnit: null, costPerRecipeUnit: 4.2, costSource: "invoice" },
            { id: "c2", name: "Beef patty", defaultUnit: "ea", recipeUnit: "ea", costPerRecipeUnit: null, costSource: null },
          ]),
        },
        invoiceLineItem: { findFirst },
        $queryRaw: queryRaw,
      }),
    )
    expect(queryRaw).toHaveBeenCalledTimes(1)
    expect(findFirst).not.toHaveBeenCalled()
    expect(rows[0]).toMatchObject({ ingredient: "Ground beef", vendor: "Sysco", lastInvoiceDate: "2026-11-03" })
    expect(rows[1]).toMatchObject({ ingredient: "Beef patty", vendor: null, lastInvoiceDate: null })
  })
})
