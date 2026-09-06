import { beforeEach, describe, expect, it, vi } from "vitest"
const { db } = vi.hoisted(() => ({ db: {
  store: { findMany: vi.fn(), findFirst: vi.fn() },
  stockCount: { findUnique: vi.fn() },
  stockCountLine: { findMany: vi.fn() },
  canonicalIngredient: { findMany: vi.fn() },
  ingredientModelState: { count: vi.fn() },
} }))
vi.mock("@/lib/prisma", () => ({ prisma: db }))
import { getInventorySections } from "@/lib/counter/adapters/inventory"
import { getCountSessionSectionPromises } from "@/lib/counter/adapters/stock-counts"

beforeEach(() => {
  vi.clearAllMocks()
  db.store.findMany.mockResolvedValue([])
  db.ingredientModelState.count.mockResolvedValue(0)
})

describe("inventory scope and count units", () => {
  it("requires an explicit store without querying an arbitrary first store", async () => {
    const sections = await getInventorySections({ accountId: "account", storeId: null, today: new Date() })
    for (const section of Object.values(sections)) {
      expect(section).toEqual({ status: "empty", reason: "select_store" })
    }
    expect(db.store.findFirst).not.toHaveBeenCalled()
  })
  it("scopes the selected store to the signed-in account", async () => {
    db.store.findFirst.mockResolvedValue(null)
    await getInventorySections({ accountId: "account", storeId: "glendale", today: new Date() })
    expect(db.store.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { accountId: "account", isActive: true, id: "glendale" },
    }))
  })
  it("loads converted recipe quantities for the recipe-unit entry field", async () => {
    db.stockCount.findUnique.mockResolvedValue({ id: "count", status: "IN_PROGRESS", store: { accountId: "account" } })
    db.canonicalIngredient.findMany.mockResolvedValue([{ id: "beef", name: "beef", category: "Food", recipeUnit: "oz" }])
    db.stockCountLine.findMany.mockResolvedValue([{ canonicalIngredientId: "beef", nativeQty: 2, nativeUnit: "lb", qtyInRecipeUnit: 32 }])
    const section = await getCountSessionSectionPromises({ accountId: "account", countId: "count" }).entry
    expect(section.status).toBe("ready")
    if (section.status !== "ready") throw new Error("Entry did not load")
    expect(section.data.rows[0]).toMatchObject({ unit: "oz", entered: 32 })
  })
})
