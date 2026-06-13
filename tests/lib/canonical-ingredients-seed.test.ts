// seedCanonicalIngredientsFromInvoices must scan InvoiceLineItem in bounded
// batches (2026-06-12 audit, Tier 2): the old single findMany loaded every
// unlinked line item in the account into memory. Pagination must use a seek
// condition (id > lastId), NOT prisma cursor/skip — the loop updates rows it
// has scanned, and a cursor row that no longer matches the filter would make
// skip:1 drop a valid row. The dedup indexes live across batches, so a SKU
// seen in batch 1 must reuse its canonical in batch 2.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    invoiceLineItem: { findMany: vi.fn(), update: vi.fn() },
    ingredientSkuMatch: { findMany: vi.fn(), upsert: vi.fn() },
    ingredientAlias: { findMany: vi.fn(), create: vi.fn() },
    canonicalIngredient: { findMany: vi.fn(), create: vi.fn() },
  },
}))

import { prisma } from "@/lib/prisma"
import { seedCanonicalIngredientsFromInvoices } from "@/lib/canonical-ingredients"

type LineItemRow = {
  id: string
  sku: string | null
  productName: string
  unit: string | null
  category: string | null
  invoice: { vendorName: string; storeId: string | null }
}

/** Serve `rows` through a seek-paginated findMany mock (id > lastId, take). */
function serveLineItems(rows: LineItemRow[]) {
  vi.mocked(prisma.invoiceLineItem.findMany).mockImplementation((async (args: {
    where?: { id?: { gt?: string } }
    take?: number
  }) => {
    const after = args?.where?.id?.gt
    const sorted = [...rows].sort((a, b) => a.id.localeCompare(b.id))
    const start = after ? sorted.findIndex((r) => r.id > after) : 0
    const slice = start === -1 ? [] : sorted.slice(start)
    return args?.take != null ? slice.slice(0, args.take) : slice
  }) as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.ingredientSkuMatch.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.ingredientSkuMatch.upsert).mockResolvedValue({} as never)
  vi.mocked(prisma.ingredientAlias.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.ingredientAlias.create).mockResolvedValue({} as never)
  vi.mocked(prisma.canonicalIngredient.findMany).mockResolvedValue([] as never)
  let n = 0
  vi.mocked(prisma.canonicalIngredient.create).mockImplementation((async () => ({
    id: `canon-${++n}`,
  })) as never)
  vi.mocked(prisma.invoiceLineItem.update).mockResolvedValue({} as never)
})

describe("seedCanonicalIngredientsFromInvoices — pagination", () => {
  it("scans line items in bounded batches and still processes every row", async () => {
    // 1,200 SKU-less rows with no storeId -> all skipped, no per-row writes.
    const rows: LineItemRow[] = Array.from({ length: 1200 }, (_, i) => ({
      id: `li-${String(i).padStart(5, "0")}`,
      sku: null,
      productName: `Item ${i}`,
      unit: "cs",
      category: null,
      invoice: { vendorName: "Sysco", storeId: null },
    }))
    serveLineItems(rows)

    const result = await seedCanonicalIngredientsFromInvoices("u1", "acct-A")

    expect(result.skipped).toBe(1200)

    const calls = vi.mocked(prisma.invoiceLineItem.findMany).mock.calls
    expect(calls.length).toBeGreaterThan(1)
    for (const [args] of calls) {
      const take = (args as { take?: number })?.take
      expect(take, "every line-item scan must be bounded").toBeDefined()
      expect(take!).toBeLessThanOrEqual(500)
    }
  })

  it("reuses a canonical for the same (vendor, sku) across batch boundaries", async () => {
    // Two rows with the same vendor+sku, ids far enough apart to land in
    // different batches once 500+ filler rows sit between them.
    const filler: LineItemRow[] = Array.from({ length: 510 }, (_, i) => ({
      id: `li-m-${String(i).padStart(5, "0")}`,
      sku: null,
      productName: `Filler ${i}`,
      unit: "cs",
      category: null,
      invoice: { vendorName: "Sysco", storeId: null },
    }))
    const rows: LineItemRow[] = [
      {
        id: "li-a-first",
        sku: "SKU-42",
        productName: "American Cheese",
        unit: "cs",
        category: "Dairy",
        invoice: { vendorName: "Sysco", storeId: "s1" },
      },
      ...filler,
      {
        id: "li-z-last",
        sku: "SKU-42",
        productName: "American Cheese (Sliced)",
        unit: "cs",
        category: "Dairy",
        invoice: { vendorName: "Sysco", storeId: "s1" },
      },
    ]
    serveLineItems(rows)

    const result = await seedCanonicalIngredientsFromInvoices("u1", "acct-A")

    // One canonical + one sku match for both rows; both line items linked to it.
    expect(result.canonicalsCreated).toBe(1)
    expect(result.skuMatchesCreated).toBe(1)
    expect(prisma.canonicalIngredient.create).toHaveBeenCalledTimes(1)

    const updates = vi.mocked(prisma.invoiceLineItem.update).mock.calls.map(([a]) => a)
    const linked = updates.filter((u) =>
      ["li-a-first", "li-z-last"].includes((u as { where: { id: string } }).where.id),
    )
    expect(linked).toHaveLength(2)
    const canonicalIds = new Set(
      linked.map((u) => (u as { data: { canonicalIngredientId: string } }).data.canonicalIngredientId),
    )
    expect(canonicalIds.size).toBe(1)
  })
})
