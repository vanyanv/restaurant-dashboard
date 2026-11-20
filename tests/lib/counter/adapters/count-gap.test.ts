// The gap between two counts — the Report tab's "missing" and the Inventory
// overview's "Went missing".
//
// 1. A line saved with a box that has no size (`nativeUnit: "partial"`) holds
//    only the part that could be converted. Read as the whole count it made
//    the unsized boxes look missing; such an item is now left out of the
//    comparison, from the lines and from the item loop alike.
// 2. When nothing could be compared, or nothing compared has a price, the
//    figure is an unknown (null), never $0.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    store: { findMany: vi.fn() },
    stockCount: { findMany: vi.fn() },
    countItem: { findMany: vi.fn() },
    invoiceLineItem: { findMany: vi.fn() },
    stockCountLine: { findMany: vi.fn() },
    canonicalIngredient: { findMany: vi.fn() },
    inventoryAdjustment: { findMany: vi.fn() },
  },
}))
vi.mock("@/lib/inventory/store-inventory-context", () => ({
  loadStoreInventoryContext: vi.fn(),
  runningOnHandFromContext: vi.fn(),
}))

import { prisma } from "@/lib/prisma"
import { runningOnHandFromContext } from "@/lib/inventory/store-inventory-context"
import { anchorLineWhere } from "@/lib/inventory/anchor-line"
import { getCountReportSectionPromises, loadLatestGap } from "@/lib/counter/adapters/count"
import { hasData } from "@/lib/counter/section-data"

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

const PREV = new Date("2026-10-20T15:00:00Z")
const CUR = new Date("2026-10-27T15:00:00Z")

type Line = { canonicalIngredientId: string; qtyInRecipeUnit: number; nativeUnit: string | null }
/** The current count's lines. The mock applies the anchor filter the way the database would. */
let curLines: Line[] = []
let prices: Record<string, number | null> = {}

beforeEach(() => {
  vi.clearAllMocks()
  // Beef was counted as 1 case (80 lb) + 2 trays with no size: the saved 80 is a floor.
  curLines = [
    { canonicalIngredientId: "ci_beef", qtyInRecipeUnit: 80, nativeUnit: "partial" },
    { canonicalIngredientId: "ci_buns", qtyInRecipeUnit: 40, nativeUnit: "each" },
  ]
  prices = { ci_beef: 5, ci_buns: 0.5 }
  asMock(prisma.store.findMany).mockResolvedValue([{ id: "store_a", name: "Hollywood", isActive: true }])
  asMock(prisma.stockCount.findMany).mockResolvedValue([
    { id: "sc_cur", countedAt: CUR },
    { id: "sc_prev", countedAt: PREV },
  ])
  asMock(prisma.countItem.findMany).mockResolvedValue([])
  asMock(prisma.invoiceLineItem.findMany).mockResolvedValue([])
  asMock(prisma.stockCountLine.findMany).mockImplementation(async (args: { where: Record<string, unknown> }) =>
    curLines.filter((l) => !args.where.OR || l.nativeUnit !== "partial"),
  )
  // Answers with every item on the count, whatever the filter: the loop itself must not read a
  // filtered-out line as "counted 0".
  asMock(prisma.canonicalIngredient.findMany).mockImplementation(async () =>
    curLines.map((l) => ({ id: l.canonicalIngredientId, name: l.canonicalIngredientId.slice(3), recipeUnit: l.canonicalIngredientId === "ci_beef" ? "lb" : "each", costPerRecipeUnit: prices[l.canonicalIngredientId] })),
  )
  const at = new Date("2026-10-24T12:00:00Z")
  asMock(prisma.inventoryAdjustment.findMany).mockResolvedValue([
    { canonicalIngredientId: "ci_beef", reason: "DROPPED", qty: 2, occurredAt: at, canonicalIngredient: { costPerRecipeUnit: 5 } },
  ])
  // beef: should have 90. buns: should have 50, counted 40 → 10 short.
  asMock(runningOnHandFromContext).mockImplementation((_ctx: unknown, ing: { id: string }) =>
    ing.id === "ci_beef"
      ? { baseAt: PREV, baseQty: 100, deliveriesQty: 0, depletionQty: 8, adjustmentsQty: 2, onHand: 90, partial: false }
      : { baseAt: PREV, baseQty: 50, deliveriesQty: 0, depletionQty: 0, adjustmentsQty: 0, onHand: 50, partial: false },
  )
})

async function report() {
  const s = await getCountReportSectionPromises({ accountId: "acct_ours" }).report
  if (!hasData(s) || s.data === null) throw new Error("report did not load")
  return s.data
}

describe("the gap between two counts", () => {
  it("leaves out an item whose line on this count has a box with no size", async () => {
    const d = await report()
    // Before: beef read as counted 80 against 90 → 10 lb, $50 "missing" that is sitting in two trays.
    expect(d.rows.map((r) => r.name)).toEqual(["Buns"])
    expect(d.missingDollars).toBe(5) // 10 buns × $0.50, and nothing for beef
    // Beef's waste entry is still reported, apart from the rows.
    expect(d.wasteEntries).toBe(0)
    expect(d.offReportEntries).toBe(1)
    expect(d.offReportDollars).toBe(10)
  })

  it("does not read that item as counted at zero either", async () => {
    const d = await report()
    expect(d.rows.find((r) => r.name === "Beef")).toBeUndefined()
    // A zero would have been 90 lb × $5 = $450 missing.
    expect(d.missingDollars).toBeLessThan(50)
  })

  it("asks for whole lines only, on this account's count", async () => {
    await report()
    const where = asMock(prisma.stockCountLine.findMany).mock.calls[0][0].where
    expect(where).toMatchObject({ stockCountId: "sc_cur", stockCount: { storeId: "store_a", store: { accountId: "acct_ours" } }, ...anchorLineWhere })
    const ings = asMock(prisma.canonicalIngredient.findMany).mock.calls[0][0].where
    expect(ings).toMatchObject({ accountId: "acct_ours", stockCountLines: { some: { stockCountId: "sc_cur", ...anchorLineWhere } } })
  })

  it("still compares an item whose line is whole", async () => {
    curLines[0].nativeUnit = "lb"
    const d = await report()
    expect(d.rows.map((r) => r.name).sort()).toEqual(["Beef", "Buns"])
    expect(d.missingDollars).toBe(55) // 10 lb beef × $5 + 10 buns × $0.50
  })
})

describe("Went missing on the Inventory overview", () => {
  it("is the Report tab's figure and says what it covers", async () => {
    expect(await loadLatestGap("acct_ours", "store_a")).toEqual({ from: "Tue, Oct 20", to: "Tue, Oct 27", items: 1, missingDollars: 5, unpriced: 0 })
  })

  it("is an unknown, not $0, when no compared item has a price", async () => {
    prices.ci_buns = null
    expect(await loadLatestGap("acct_ours", "store_a")).toMatchObject({ items: 1, unpriced: 1, missingDollars: null })
  })

  it("is an unknown, not $0, when nothing was counted both times", async () => {
    curLines = [curLines[0]] // only the line with a box that has no size
    expect(await loadLatestGap("acct_ours", "store_a")).toMatchObject({ items: 0, unpriced: 0, missingDollars: null })
  })

  it("is null until the store has two finished counts", async () => {
    asMock(prisma.stockCount.findMany).mockResolvedValue([{ id: "sc_cur", countedAt: CUR }])
    expect(await loadLatestGap("acct_ours", "store_a")).toBeNull()
  })

  it("is a real $0.00 when items were compared, priced, and nothing is short", async () => {
    curLines[1].qtyInRecipeUnit = 50
    expect(await loadLatestGap("acct_ours", "store_a")).toMatchObject({ items: 1, missingDollars: 0 })
  })
})
