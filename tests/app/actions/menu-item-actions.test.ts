// menu-item mapping actions — the human-confirm write path for POS item →
// recipe mappings. Pins auth/account scoping, the per-store upsert fan-out,
// batch validation filtering, and the catalog's mapping precedence.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth-scope", () => ({ getAuthScope: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/otter-subitem-aggregation", () => ({ attachSubItemMappings: vi.fn() }))
vi.mock("@/lib/menu-sell-price-aggregation", () => ({ mergeSellPrices: vi.fn() }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    store: { findMany: vi.fn() },
    recipe: { findFirst: vi.fn(), findMany: vi.fn() },
    otterItemMapping: { findMany: vi.fn(), upsert: vi.fn() },
    otterMenuItem: { groupBy: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  },
}))

import { getAuthScope } from "@/lib/auth-scope"
import { prisma } from "@/lib/prisma"
import {
  getMenuItemsForCatalog,
  mapOtterItemToRecipe,
  mapOtterItemsBatch,
} from "@/app/actions/menu-item-actions"

const scope = { ownerId: "u1", accountId: "acct-A", role: "OWNER" }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAuthScope).mockResolvedValue(scope as never)
  vi.mocked(prisma.store.findMany).mockResolvedValue([
    { id: "s1" },
    { id: "s2" },
  ] as never)
  // upsert returns the args so tests can inspect what the transaction ran
  vi.mocked(prisma.otterItemMapping.upsert).mockImplementation(((args: unknown) =>
    Promise.resolve(args)) as never)
})

describe("mapOtterItemToRecipe", () => {
  it("throws when not authenticated", async () => {
    vi.mocked(getAuthScope).mockResolvedValue(null as never)
    await expect(
      mapOtterItemToRecipe({ otterItemName: "Burger", recipeId: "r1" })
    ).rejects.toThrow("Not authenticated")
    expect(prisma.otterItemMapping.upsert).not.toHaveBeenCalled()
  })

  it("rejects a recipe outside the caller's account", async () => {
    vi.mocked(prisma.recipe.findFirst).mockResolvedValue(null as never)
    await expect(
      mapOtterItemToRecipe({ otterItemName: "Burger", recipeId: "r-other" })
    ).rejects.toThrow("Recipe not found")
    const where = vi.mocked(prisma.recipe.findFirst).mock.calls[0][0]?.where
    expect(where).toMatchObject({ id: "r-other", accountId: "acct-A" })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("upserts one mapping per store keyed on (storeId, otterItemName)", async () => {
    vi.mocked(prisma.recipe.findFirst).mockResolvedValue({ id: "r1" } as never)

    await mapOtterItemToRecipe({ otterItemName: "Burger", recipeId: "r1" })

    const upsertCalls = vi.mocked(prisma.otterItemMapping.upsert).mock.calls
    expect(upsertCalls).toHaveLength(2)
    expect(
      upsertCalls.map((c) => c[0]!.where.storeId_otterItemName!.storeId)
    ).toEqual(["s1", "s2"])
    expect(upsertCalls[0][0]).toMatchObject({
      create: { storeId: "s1", otterItemName: "Burger", recipeId: "r1" },
      update: { recipeId: "r1" },
    })
    expect(upsertCalls[0][0].update.confirmedAt).toBeInstanceOf(Date)
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
  })
})

describe("mapOtterItemsBatch", () => {
  it("returns {mapped: 0} without a transaction for empty pairs", async () => {
    expect(await mapOtterItemsBatch([])).toEqual({ mapped: 0 })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("filters out pairs whose recipe is not in the account and maps the rest", async () => {
    vi.mocked(prisma.recipe.findMany).mockResolvedValue([{ id: "r-good" }] as never)

    const result = await mapOtterItemsBatch([
      { otterItemName: "Burger", recipeId: "r-good" },
      { otterItemName: "Hijack", recipeId: "r-foreign" },
    ])

    expect(result).toEqual({ mapped: 1 })
    // 1 valid pair × 2 stores
    const upsertCalls = vi.mocked(prisma.otterItemMapping.upsert).mock.calls
    expect(upsertCalls).toHaveLength(2)
    for (const call of upsertCalls) {
      expect(call[0].create.otterItemName).toBe("Burger")
      expect(call[0].create.recipeId).toBe("r-good")
    }
  })

  it("returns {mapped: 0} when no pair survives validation", async () => {
    vi.mocked(prisma.recipe.findMany).mockResolvedValue([] as never)
    const result = await mapOtterItemsBatch([
      { otterItemName: "Burger", recipeId: "r-foreign" },
    ])
    expect(result).toEqual({ mapped: 0 })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})

describe("getMenuItemsForCatalog", () => {
  it("prefers the explicit OtterItemMapping over the case-insensitive recipe-name fallback", async () => {
    const day = new Date("2026-07-10")
    vi.mocked(prisma.otterMenuItem.groupBy).mockResolvedValue([
      {
        itemName: "Burger",
        category: "Sliders",
        _sum: { fpQuantitySold: 5, tpQuantitySold: 3 },
        _min: { date: day },
        _max: { date: day },
      },
      {
        itemName: "Fries",
        category: "Sides",
        _sum: { fpQuantitySold: 2, tpQuantitySold: 0 },
        _min: { date: day },
        _max: { date: day },
      },
    ] as never)
    vi.mocked(prisma.otterMenuItem.findMany).mockResolvedValue([
      { storeId: "s1", itemName: "Burger", category: "Sliders" },
      { storeId: "s1", itemName: "Fries", category: "Sides" },
    ] as never)
    vi.mocked(prisma.otterItemMapping.findMany).mockResolvedValue([
      {
        otterItemName: "Burger",
        recipeId: "r-mapped",
        recipe: { id: "r-mapped", itemName: "Mapped Burger Recipe" },
      },
    ] as never)
    vi.mocked(prisma.recipe.findMany).mockResolvedValue([
      { id: "r-by-name", itemName: "BURGER" },
      { id: "r-fries", itemName: "fries" },
    ] as never)

    const rows = await getMenuItemsForCatalog()

    const burger = rows.find((r) => r.otterItemName === "Burger")!
    const fries = rows.find((r) => r.otterItemName === "Fries")!
    // Explicit mapping wins even though a recipe named "BURGER" exists.
    expect(burger.mappedRecipeId).toBe("r-mapped")
    expect(burger.totalQtySoldAllTime).toBe(8)
    // No explicit mapping → case-insensitive name fallback.
    expect(fries.mappedRecipeId).toBe("r-fries")
    // Sorted by qty desc.
    expect(rows[0].otterItemName).toBe("Burger")
  })
})
