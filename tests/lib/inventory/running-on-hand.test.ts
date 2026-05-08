// computeRunningOnHand — given a (storeId, ingredientId, asOf), returns the
// estimated on-hand quantity in the canonical's recipeUnit. Math:
//
//   onHand = baseCountQty
//          + Σ invoice deliveries (since baseCount, ≤ asOf)
//          − Σ theoretical depletion (sales × recipe-walk for ingredient)
//          − Σ inventory adjustments
//
// Tests use mocked Prisma. `walkRecipeForIngredient` is mocked at the module
// level so each test can assert exactly how much the recipe walk contributed.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    canonicalIngredient: { findUnique: vi.fn() },
    stockCountLine: { findFirst: vi.fn() },
    invoiceLineItem: { findMany: vi.fn() },
    otterMenuItem: { findMany: vi.fn() },
    otterItemMapping: { findMany: vi.fn() },
    inventoryAdjustment: { findMany: vi.fn() },
  },
}))

vi.mock("@/lib/inventory/recipe-walk", () => ({
  walkRecipeForIngredient: vi.fn(),
}))

import { prisma } from "@/lib/prisma"
import { walkRecipeForIngredient } from "@/lib/inventory/recipe-walk"
import { computeRunningOnHand } from "@/lib/inventory/running-on-hand"

const ING = {
  id: "ing-1",
  name: "Mozzarella",
  recipeUnit: "lb",
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.canonicalIngredient.findUnique).mockResolvedValue(ING as never)
  vi.mocked(prisma.stockCountLine.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.invoiceLineItem.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.otterMenuItem.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.otterItemMapping.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.inventoryAdjustment.findMany).mockResolvedValue([] as never)
  vi.mocked(walkRecipeForIngredient).mockResolvedValue(0)
})

describe("computeRunningOnHand", () => {
  it("returns null when the ingredient doesn't exist", async () => {
    vi.mocked(prisma.canonicalIngredient.findUnique).mockResolvedValue(null)
    const result = await computeRunningOnHand({ storeId: "s1", ingredientId: "missing" })
    expect(result).toBeNull()
  })

  it("returns 0 on-hand when there's no count, no invoices, no sales, no adjustments", async () => {
    const result = await computeRunningOnHand({ storeId: "s1", ingredientId: "ing-1" })
    expect(result).not.toBeNull()
    expect(result!.onHand).toBe(0)
    expect(result!.baseQty).toBe(0)
    expect(result!.baseAt).toBeNull()
  })

  it("anchors on the most recent COMPLETED count for this (store, ingredient)", async () => {
    vi.mocked(prisma.stockCountLine.findFirst).mockResolvedValue({
      qtyInRecipeUnit: 12,
      stockCount: { countedAt: new Date("2026-05-01") },
    } as never)
    const result = await computeRunningOnHand({
      storeId: "s1",
      ingredientId: "ing-1",
      asOf: new Date("2026-05-08"),
    })
    expect(result!.baseQty).toBe(12)
    expect(result!.baseAt).toEqual(new Date("2026-05-01"))
    expect(result!.onHand).toBe(12)
  })

  it("adds invoice deliveries since the count (converting units to recipeUnit)", async () => {
    vi.mocked(prisma.stockCountLine.findFirst).mockResolvedValue({
      qtyInRecipeUnit: 10,
      stockCount: { countedAt: new Date("2026-05-01") },
    } as never)
    vi.mocked(prisma.invoiceLineItem.findMany).mockResolvedValue([
      { quantity: 5, unit: "lb" },
      { quantity: 16, unit: "oz" }, // 1 lb
    ] as never)
    const result = await computeRunningOnHand({
      storeId: "s1",
      ingredientId: "ing-1",
      asOf: new Date("2026-05-08"),
    })
    expect(result!.deliveriesQty).toBe(6)
    expect(result!.onHand).toBe(16)
  })

  it("subtracts theoretical depletion: per-recipe walk × quantity sold", async () => {
    vi.mocked(prisma.stockCountLine.findFirst).mockResolvedValue({
      qtyInRecipeUnit: 20,
      stockCount: { countedAt: new Date("2026-05-01") },
    } as never)
    vi.mocked(prisma.otterMenuItem.findMany).mockResolvedValue([
      { itemName: "Margherita", fpQuantitySold: 4, tpQuantitySold: 2 },
    ] as never)
    vi.mocked(prisma.otterItemMapping.findMany).mockResolvedValue([
      { otterItemName: "Margherita", recipeId: "rec-1" },
    ] as never)
    vi.mocked(walkRecipeForIngredient).mockResolvedValue(0.5) // 0.5 lb cheese per pizza
    const result = await computeRunningOnHand({
      storeId: "s1",
      ingredientId: "ing-1",
      asOf: new Date("2026-05-08"),
    })
    // 6 pizzas × 0.5 lb = 3 lb depleted
    expect(result!.depletionQty).toBe(3)
    expect(result!.onHand).toBe(17)
  })

  it("does NOT count sales of items with no recipe mapping toward depletion", async () => {
    vi.mocked(prisma.otterMenuItem.findMany).mockResolvedValue([
      { itemName: "Mystery Item", fpQuantitySold: 100, tpQuantitySold: 0 },
    ] as never)
    vi.mocked(prisma.otterItemMapping.findMany).mockResolvedValue([] as never)
    vi.mocked(walkRecipeForIngredient).mockResolvedValue(0.5)
    const result = await computeRunningOnHand({ storeId: "s1", ingredientId: "ing-1" })
    expect(result!.depletionQty).toBe(0)
  })

  it("subtracts inventory adjustments (positive qty = removed)", async () => {
    vi.mocked(prisma.stockCountLine.findFirst).mockResolvedValue({
      qtyInRecipeUnit: 10,
      stockCount: { countedAt: new Date("2026-05-01") },
    } as never)
    vi.mocked(prisma.inventoryAdjustment.findMany).mockResolvedValue([
      { qty: 2 },
      { qty: 1 },
    ] as never)
    const result = await computeRunningOnHand({
      storeId: "s1",
      ingredientId: "ing-1",
      asOf: new Date("2026-05-08"),
    })
    expect(result!.adjustmentsQty).toBe(3)
    expect(result!.onHand).toBe(7)
  })

  it("memoizes the per-recipe walk so multi-day sales of the same item don't recompute", async () => {
    vi.mocked(prisma.otterMenuItem.findMany).mockResolvedValue([
      { itemName: "Margherita", fpQuantitySold: 1, tpQuantitySold: 0 },
      { itemName: "Margherita", fpQuantitySold: 2, tpQuantitySold: 0 },
      { itemName: "Margherita", fpQuantitySold: 3, tpQuantitySold: 0 },
    ] as never)
    vi.mocked(prisma.otterItemMapping.findMany).mockResolvedValue([
      { otterItemName: "Margherita", recipeId: "rec-1" },
    ] as never)
    vi.mocked(walkRecipeForIngredient).mockResolvedValue(1)
    const result = await computeRunningOnHand({ storeId: "s1", ingredientId: "ing-1" })
    expect(result!.depletionQty).toBe(6)
    expect(walkRecipeForIngredient).toHaveBeenCalledTimes(1)
  })

  it("flags `partial` when an invoice line uses a unit that can't be converted to the recipe unit", async () => {
    vi.mocked(prisma.invoiceLineItem.findMany).mockResolvedValue([
      { quantity: 5, unit: "head" }, // can't convert head → lb
    ] as never)
    const result = await computeRunningOnHand({ storeId: "s1", ingredientId: "ing-1" })
    expect(result!.partial).toBe(true)
    expect(result!.deliveriesQty).toBe(0)
  })

  it("scopes invoice / sales / adjustment queries to the requested store", async () => {
    await computeRunningOnHand({
      storeId: "s1",
      ingredientId: "ing-1",
      asOf: new Date("2026-05-08"),
    })
    const inv = vi.mocked(prisma.invoiceLineItem.findMany).mock.calls[0][0] as {
      where: { invoice: { storeId: string } }
    }
    expect(inv.where.invoice.storeId).toBe("s1")
    const sales = vi.mocked(prisma.otterMenuItem.findMany).mock.calls[0][0] as {
      where: { storeId: string }
    }
    expect(sales.where.storeId).toBe("s1")
    const adj = vi.mocked(prisma.inventoryAdjustment.findMany).mock.calls[0][0] as {
      where: { storeId: string }
    }
    expect(adj.where.storeId).toBe("s1")
  })
})
