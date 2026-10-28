// What counts as a purchase — `src/lib/counter/purchases.ts` — and the two
// pages that set purchases against usage.
//
// Product usage set ONE store's theoretical usage (DailyCogsItem, filtered by
// the picked store) against EVERY store's invoices (filtered on `accountId`
// alone), and its chart summed every invoice line while the headline summed
// only lines matched to an ingredient. Inventory's "delivered" scoped by store
// but, like Product usage, counted invoices the owner had REJECTED.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    canonicalIngredient: { findMany: vi.fn() },
    store: { findFirst: vi.fn() },
    stockCount: { findMany: vi.fn() },
    stockCountLine: { findMany: vi.fn() },
    invoice: { findFirst: vi.fn() },
    invoiceLineItem: { aggregate: vi.fn() },
    dailyCogsItem: { aggregate: vi.fn() },
    ingredientModelState: { count: vi.fn() },
    $queryRaw: vi.fn(),
  },
}))
vi.mock("@/lib/account-stores", () => ({ getScopedStores: vi.fn() }))
vi.mock("@/lib/recipe-cost", () => ({ batchRecipeCosts: vi.fn() }))

import { prisma } from "@/lib/prisma"
import { getScopedStores } from "@/lib/account-stores"
import { batchRecipeCosts } from "@/lib/recipe-cost"
import { purchaseLineFilterSql, purchaseLineWhere } from "@/lib/counter/purchases"
import { getProductUsageSectionPromises } from "@/lib/counter/adapters/product-usage"
import { getInventorySections } from "@/lib/counter/adapters/inventory"

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

/** A `Prisma.sql` fragment (or plain value) written out as text. */
function text(v: unknown): string {
  if (v && typeof v === "object" && "strings" in v) {
    const frag = v as { strings: string[]; values: unknown[] }
    return frag.strings
      .map((s, i) => s + (i < frag.values.length ? text(frag.values[i]) : ""))
      .join("")
  }
  return "?"
}

/** Every raw query this load ran, with interpolated fragments spliced in. */
function rawSql(): string[] {
  return asMock(prisma.$queryRaw).mock.calls.map((c) => {
    const strings = c[0] as string[]
    const values = c.slice(1)
    return strings.map((s, i) => s + (i < values.length ? text(values[i]) : "")).join("")
  })
}

const invoiceQueries = () => rawSql().filter((t) => t.includes('"InvoiceLineItem"'))

beforeEach(() => {
  vi.clearAllMocks()
  asMock(prisma.$queryRaw).mockResolvedValue([])
  asMock(batchRecipeCosts).mockResolvedValue(new Map())
  asMock(prisma.canonicalIngredient.findMany).mockResolvedValue([])
})

describe("purchase rule", () => {
  const base = { accountId: "acct_1", from: new Date("2026-09-01"), to: new Date("2026-09-30") }

  it("a picked store: that store, matched lines, no rejected invoices", () => {
    const sql = text(purchaseLineFilterSql({ ...base, storeIds: ["holly"], allStores: false }))
    expect(sql).toContain('i."accountId" = ?')
    expect(sql).toContain('i."storeId" IN (?)')
    expect(sql).not.toContain("IS NULL)")
    expect(sql).toContain('li."canonicalIngredientId" IS NOT NULL')
    expect(sql).toContain(`i."status" <> 'REJECTED'`)
    expect(sql).toContain('i."invoiceDate" >= ?')
    expect(sql).toContain('i."invoiceDate" <= ?')
  })

  it("a store not on the account matches nothing, not the account", () => {
    const sql = text(purchaseLineFilterSql({ ...base, storeIds: [], allStores: false }))
    expect(sql).toContain("AND FALSE")
  })

  it("all stores: the active stores plus invoices assigned to none", () => {
    const sql = text(purchaseLineFilterSql({ ...base, storeIds: ["a", "b"], allStores: true }))
    expect(sql).toContain('(i."storeId" IN (?,?) OR i."storeId" IS NULL)')
  })

  it("the Prisma form says the same thing", () => {
    expect(purchaseLineWhere({ accountId: "acct_1", storeIds: ["holly"], allStores: false })).toEqual({
      canonicalIngredientId: { not: null },
      invoice: { accountId: "acct_1", status: { not: "REJECTED" }, storeId: { in: ["holly"] } },
    })
    expect(
      purchaseLineWhere({ accountId: "acct_1", storeIds: ["a"], allStores: true, from: base.from }),
    ).toEqual({
      canonicalIngredientId: { not: null },
      invoice: {
        accountId: "acct_1",
        status: { not: "REJECTED" },
        OR: [{ storeId: { in: ["a"] } }, { storeId: null }],
        invoiceDate: { gte: base.from },
      },
    })
  })
})

describe("product usage · purchases", () => {
  async function load(storeId: string | null) {
    asMock(getScopedStores).mockResolvedValue([{ id: "holly" }])
    await getProductUsageSectionPromises({
      storeId,
      accountId: "acct_1",
      range: { start: new Date(2026, 8, 1), end: new Date(2026, 8, 30) },
    }).variance
  }

  it("scopes both invoice queries to the picked store, as the theoretical side is", async () => {
    await load("holly")
    const sql = invoiceQueries()
    expect(sql).toHaveLength(2)
    for (const t of sql) {
      expect(t).toContain('i."storeId" IN (?)')
      expect(t).toContain(`i."status" <> 'REJECTED'`)
    }
  })

  it("the chart and the headline sum the same lines — matched ones only", async () => {
    await load("holly")
    for (const t of invoiceQueries()) expect(t).toContain('li."canonicalIngredientId" IS NOT NULL')
  })

  it("all stores includes invoices assigned to no store", async () => {
    await load(null)
    for (const t of invoiceQueries()) expect(t).toContain('OR i."storeId" IS NULL')
  })
})

describe("inventory · delivered", () => {
  it("leaves rejected invoices out of delivered and the weekly strip", async () => {
    asMock(prisma.store.findFirst).mockResolvedValue({ id: "holly", name: "Hollywood" })
    asMock(prisma.stockCount.findMany).mockResolvedValue([])
    asMock(prisma.stockCountLine.findMany).mockResolvedValue([])
    asMock(prisma.invoice.findFirst).mockResolvedValue({ invoiceDate: new Date("2026-08-01") })
    asMock(prisma.invoiceLineItem.aggregate).mockResolvedValue({ _sum: { extendedPrice: 0 } })
    asMock(prisma.dailyCogsItem.aggregate).mockResolvedValue({ _sum: { lineCost: 0 } })
    asMock(prisma.ingredientModelState.count).mockResolvedValue(0)

    await getInventorySections({ accountId: "acct_1", storeId: "holly", today: new Date() })

    const where = asMock(prisma.invoiceLineItem.aggregate).mock.calls[0][0].where
    expect(where).toEqual({
      canonicalIngredientId: { not: null },
      invoice: {
        accountId: "acct_1",
        status: { not: "REJECTED" },
        storeId: { in: ["holly"] },
        invoiceDate: { gte: new Date("2026-08-01") },
      },
    })
    const weekly = invoiceQueries()
    expect(weekly).toHaveLength(1)
    expect(weekly[0]).toContain(`i."status" <> 'REJECTED'`)
    expect(weekly[0]).toContain('i."storeId" IN (?)')
  })
})
