// Spend is the ledger's sort key, so this aggregation decides what an owner
// sees first. Vendor names are normalised because "Sysco" and "Sysco Los
// Angeles, Inc" are one supplier and must not read as two.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: { invoiceLineItem: { findMany: vi.fn() } },
}))

import { prisma } from "@/lib/prisma"
import { batchCanonicalSpend } from "@/lib/canonical-spend-batch"

const line = (over: Record<string, unknown> = {}) => ({
  canonicalIngredientId: "c1",
  extendedPrice: 100,
  sku: "A",
  invoice: { vendorName: "Sysco", invoiceDate: new Date("2026-08-01") },
  ...over,
})

beforeEach(() => vi.clearAllMocks())

describe("batchCanonicalSpend", () => {
  it("sums spend and counts lines per canonical", async () => {
    vi.mocked(prisma.invoiceLineItem.findMany).mockResolvedValue([
      line({ extendedPrice: 100 }),
      line({ extendedPrice: 50 }),
      line({ canonicalIngredientId: "c2", extendedPrice: 20 }),
    ] as never)

    const map = await batchCanonicalSpend("acct-1")
    expect(map.get("c1")?.spend).toBe(150)
    expect(map.get("c1")?.lineCount).toBe(2)
    expect(map.get("c2")?.spend).toBe(20)
  })

  it("normalises vendor names so one supplier counts once", async () => {
    vi.mocked(prisma.invoiceLineItem.findMany).mockResolvedValue([
      line({ invoice: { vendorName: "Sysco", invoiceDate: new Date("2026-08-01") } }),
      line({
        invoice: { vendorName: "Sysco Los Angeles, Inc", invoiceDate: new Date("2026-08-02") },
      }),
    ] as never)

    const map = await batchCanonicalSpend("acct-1")
    expect(map.get("c1")?.vendors).toEqual(["Sysco"])
  })

  it("collects distinct SKUs and the most recent purchase date", async () => {
    vi.mocked(prisma.invoiceLineItem.findMany).mockResolvedValue([
      line({ sku: "A", invoice: { vendorName: "Sysco", invoiceDate: new Date("2026-06-01") } }),
      line({ sku: "B", invoice: { vendorName: "Sysco", invoiceDate: new Date("2026-08-10") } }),
      line({ sku: "A", invoice: { vendorName: "Sysco", invoiceDate: new Date("2026-07-01") } }),
    ] as never)

    const map = await batchCanonicalSpend("acct-1")
    expect(map.get("c1")?.skus.sort()).toEqual(["A", "B"])
    expect(map.get("c1")?.lastPurchaseAt).toEqual(new Date("2026-08-10"))
  })

  it("keeps returns negative so spend is net", async () => {
    vi.mocked(prisma.invoiceLineItem.findMany).mockResolvedValue([
      line({ extendedPrice: 100 }),
      line({ extendedPrice: -30 }),
    ] as never)

    const map = await batchCanonicalSpend("acct-1")
    expect(map.get("c1")?.spend).toBe(70)
  })

  it("ignores blank SKUs rather than recording them as a product", async () => {
    vi.mocked(prisma.invoiceLineItem.findMany).mockResolvedValue([
      line({ sku: "  " }),
      line({ sku: null }),
      line({ sku: "A" }),
    ] as never)

    expect((await batchCanonicalSpend("acct-1")).get("c1")?.skus).toEqual(["A"])
  })

  it("scopes the query to the account and the requested window", async () => {
    vi.mocked(prisma.invoiceLineItem.findMany).mockResolvedValue([] as never)
    await batchCanonicalSpend("acct-9", 30)

    const arg = vi.mocked(prisma.invoiceLineItem.findMany).mock.calls[0][0] as unknown as {
      where: { invoice: { accountId: string; invoiceDate: { gte: Date } } }
    }
    expect(arg.where.invoice.accountId).toBe("acct-9")
    expect(arg.where.invoice.invoiceDate.gte).toBeInstanceOf(Date)
  })

  it("returns an empty map when there are no matched lines", async () => {
    vi.mocked(prisma.invoiceLineItem.findMany).mockResolvedValue([] as never)
    expect((await batchCanonicalSpend("acct-1")).size).toBe(0)
  })
})
