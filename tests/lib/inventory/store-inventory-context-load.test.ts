// loadStoreInventoryContext reads sales day by day only from the oldest LAST
// count (or the lookback, whichever is earlier) and sums older sales per item.
import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    recipe: { findMany: vi.fn(async () => []) },
    otterItemMapping: { findMany: vi.fn(async () => []) },
    otterMenuItem: { findMany: vi.fn(async () => []), groupBy: vi.fn(async () => []) },
    stockCountLine: { findMany: vi.fn() },
    invoiceLineItem: { findMany: vi.fn(async () => []) },
    inventoryAdjustment: { findMany: vi.fn(async () => []) },
  },
}))

import { prisma } from "@/lib/prisma"
import { loadStoreInventoryContext } from "@/lib/inventory/store-inventory-context"

const asOf = new Date("2026-11-20T12:00:00.000Z")
const at = (d: string) => new Date(`${d}T09:00:00.000Z`)
const countLine = (id: string, d: string) => ({
  canonicalIngredientId: id,
  qtyInRecipeUnit: 1,
  stockCount: { countedAt: at(d) },
})

describe("loadStoreInventoryContext sales cutoff", () => {
  it("starts at the oldest last count, ignoring older counts of the same item", async () => {
    // Newest first, as the query orders them. Beef's last count is 11-15
    // (its 09-01 count is superseded); cheese's is 10-20.
    vi.mocked(prisma.stockCountLine.findMany).mockResolvedValue([
      countLine("beef", "2026-11-15"),
      countLine("cheese", "2026-10-20"),
      countLine("beef", "2026-09-01"),
    ] as never)
    const ctx = await loadStoreInventoryContext({ storeId: "s1", accountId: "a1", asOf })
    expect(ctx.salesCutoff).toEqual(at("2026-10-20"))
    const recent = vi.mocked(prisma.otterMenuItem.findMany).mock.calls[0][0] as { where: { date: unknown } }
    expect(recent.where.date).toEqual({ gt: at("2026-10-20"), lte: asOf })
    const before = vi.mocked(prisma.otterMenuItem.groupBy).mock.calls[0][0] as unknown as { where: { date: unknown } }
    expect(before.where.date).toEqual({ lte: at("2026-10-20") })
  })

  it("starts at the lookback when every last count is newer", async () => {
    vi.mocked(prisma.otterMenuItem.findMany).mockClear()
    vi.mocked(prisma.stockCountLine.findMany).mockResolvedValue([countLine("beef", "2026-11-18")] as never)
    const ctx = await loadStoreInventoryContext({ storeId: "s1", accountId: "a1", asOf, lookbackDays: 14 })
    expect(ctx.salesCutoff).toEqual(new Date(asOf.getTime() - 14 * 86_400_000))
  })
})
