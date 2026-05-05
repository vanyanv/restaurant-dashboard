// Contract tests for the recipe-management server actions split out of
// product-usage-actions.ts. Pins the auth/ownership behavior and the
// return-shape of each public action so the move can't silently change them.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    store: { findMany: vi.fn(), findFirst: vi.fn() },
    recipe: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      delete: vi.fn(),
    },
    otterMenuItem: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}))

import { getServerSession } from "next-auth"
import { prisma } from "@/lib/prisma"
import {
  getRecipes,
  upsertRecipe,
  deleteRecipe,
  getMenuItemsForRecipeBuilder,
} from "@/app/actions/product-usage/recipe-actions"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("getRecipes", () => {
  it("returns [] when there is no session", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    expect(await getRecipes()).toEqual([])
  })

  it("returns [] when account has no stores", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { accountId: "acct", id: "u1" },
    } as never)
    vi.mocked(prisma.store.findMany).mockResolvedValue([] as never)
    expect(await getRecipes()).toEqual([])
  })

  it("returns recipe rows with the documented field shape", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { accountId: "acct", id: "u1" },
    } as never)
    vi.mocked(prisma.store.findMany).mockResolvedValue([{ id: "s1" }] as never)
    vi.mocked(prisma.recipe.findMany).mockResolvedValue([
      {
        id: "r1",
        itemName: "Slider",
        category: "burgers",
        servingSize: 1,
        notes: null,
        foodCostOverride: null,
        isAiGenerated: false,
        isConfirmed: true,
        ingredients: [
          {
            id: "ri1",
            ingredientName: "beef",
            quantity: 0.25,
            unit: "lb",
            notes: null,
          },
        ],
      },
    ] as never)

    const result = await getRecipes()
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id: "r1",
      itemName: "Slider",
      category: "burgers",
      servingSize: 1,
      ingredients: [
        { id: "ri1", ingredientName: "beef", quantity: 0.25, unit: "lb" },
      ],
    })
  })
})

describe("upsertRecipe", () => {
  it("returns null when there is no session", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    const result = await upsertRecipe("s1", {
      itemName: "x",
      category: "y",
      ingredients: [],
    } as never)
    expect(result).toBeNull()
    expect(prisma.store.findFirst).not.toHaveBeenCalled()
  })

  it("returns null when the store does not belong to the caller's account (ownership check)", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { accountId: "acct", id: "u1" },
    } as never)
    vi.mocked(prisma.store.findFirst).mockResolvedValue(null as never)

    const result = await upsertRecipe("foreign-store", {
      itemName: "x",
      category: "y",
      ingredients: [],
    } as never)
    expect(result).toBeNull()
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})

describe("deleteRecipe", () => {
  it("returns false when there is no session", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    expect(await deleteRecipe("r1")).toBe(false)
  })

  it("returns false when the recipe is not owned by the caller's account", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { accountId: "acct", id: "u1" },
    } as never)
    vi.mocked(prisma.recipe.findFirst).mockResolvedValue(null as never)
    expect(await deleteRecipe("foreign-recipe")).toBe(false)
    expect(prisma.recipe.delete).not.toHaveBeenCalled()
  })

  it("returns true and deletes when ownership check passes", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { accountId: "acct", id: "u1" },
    } as never)
    vi.mocked(prisma.recipe.findFirst).mockResolvedValue({ id: "r1" } as never)
    vi.mocked(prisma.recipe.delete).mockResolvedValue({ id: "r1" } as never)
    expect(await deleteRecipe("r1")).toBe(true)
    expect(prisma.recipe.delete).toHaveBeenCalledWith({ where: { id: "r1" } })
  })
})

describe("getMenuItemsForRecipeBuilder", () => {
  it("returns [] when there is no session", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    expect(await getMenuItemsForRecipeBuilder()).toEqual([])
  })

  it("returns sorted rows with hasRecipe flag set against the recipe set", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { accountId: "acct", id: "u1" },
    } as never)
    vi.mocked(prisma.store.findMany).mockResolvedValue([{ id: "s1" }] as never)
    vi.mocked(prisma.otterMenuItem.findMany).mockResolvedValue([
      { itemName: "A", category: "c", fpQuantitySold: 5, tpQuantitySold: 5 },
      { itemName: "B", category: "c", fpQuantitySold: 1, tpQuantitySold: 0 },
    ] as never)
    vi.mocked(prisma.recipe.findMany).mockResolvedValue([
      { itemName: "A", category: "c" },
    ] as never)

    const result = await getMenuItemsForRecipeBuilder()
    // Sorted by totalQuantitySold desc — A (10) before B (1)
    expect(result.map((r) => r.itemName)).toEqual(["A", "B"])
    expect(result[0]).toMatchObject({
      itemName: "A",
      category: "c",
      hasRecipe: true,
      totalQuantitySold: 10,
    })
    expect(result[1]).toMatchObject({
      itemName: "B",
      hasRecipe: false,
      totalQuantitySold: 1,
    })
  })
})
