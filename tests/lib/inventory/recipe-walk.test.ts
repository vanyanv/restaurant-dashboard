// walkRecipeForIngredient — given a recipeId and a target canonicalIngredientId,
// returns the total quantity of that ingredient consumed per serving of the
// recipe, in the target's recipeUnit. Walks sub-recipes recursively. This is
// the depletion-walk counterpart to computeRecipeCost's cost-walk: same shape,
// returns quantity instead of dollars.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    recipe: { findUnique: vi.fn() },
  },
}))

import { prisma } from "@/lib/prisma"
import {
  walkRecipeForIngredient,
  RecipeWalkCycleError,
} from "@/lib/inventory/recipe-walk"

beforeEach(() => {
  vi.clearAllMocks()
})

const recipe = (
  id: string,
  ingredients: Array<{
    canonicalIngredientId?: string | null
    componentRecipeId?: string | null
    quantity: number
    unit: string
  }>
) => ({
  id,
  ingredients: ingredients.map((i) => ({
    canonicalIngredientId: i.canonicalIngredientId ?? null,
    componentRecipeId: i.componentRecipeId ?? null,
    quantity: i.quantity,
    unit: i.unit,
  })),
})

describe("walkRecipeForIngredient", () => {
  it("returns 0 when the recipe doesn't reference the ingredient", async () => {
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue(
      recipe("r1", [{ canonicalIngredientId: "other", quantity: 4, unit: "oz" }]) as never
    )
    const qty = await walkRecipeForIngredient("r1", "target", "oz")
    expect(qty).toBe(0)
  })

  it("returns 0 when the recipe doesn't exist", async () => {
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue(null)
    const qty = await walkRecipeForIngredient("missing", "target", "oz")
    expect(qty).toBe(0)
  })

  it("sums direct ingredient lines that match (same unit)", async () => {
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue(
      recipe("r1", [
        { canonicalIngredientId: "target", quantity: 2, unit: "oz" },
        { canonicalIngredientId: "target", quantity: 3, unit: "oz" },
        { canonicalIngredientId: "other", quantity: 5, unit: "oz" },
      ]) as never
    )
    const qty = await walkRecipeForIngredient("r1", "target", "oz")
    expect(qty).toBe(5)
  })

  it("converts units when the line is recorded in a compatible unit", async () => {
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue(
      recipe("r1", [{ canonicalIngredientId: "target", quantity: 1, unit: "lb" }]) as never
    )
    const qty = await walkRecipeForIngredient("r1", "target", "oz")
    expect(qty).toBe(16)
  })

  it("walks sub-recipes and multiplies by the sub-recipe line quantity", async () => {
    vi.mocked(prisma.recipe.findUnique).mockImplementation((async (args: { where: { id: string } }) => {
      if (args.where.id === "parent") {
        return recipe("parent", [{ componentRecipeId: "child", quantity: 2, unit: "serving" }])
      }
      if (args.where.id === "child") {
        return recipe("child", [{ canonicalIngredientId: "target", quantity: 3, unit: "oz" }])
      }
      return null
    }) as never)
    const qty = await walkRecipeForIngredient("parent", "target", "oz")
    expect(qty).toBe(6)
  })

  it("ignores lines for the target with un-convertible units (and returns 0 when those are the only matches)", async () => {
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue(
      recipe("r1", [{ canonicalIngredientId: "target", quantity: 1, unit: "head" }]) as never
    )
    const qty = await walkRecipeForIngredient("r1", "target", "oz")
    expect(qty).toBe(0)
  })

  it("throws RecipeWalkCycleError on a sub-recipe cycle", async () => {
    vi.mocked(prisma.recipe.findUnique).mockImplementation((async (args: { where: { id: string } }) => {
      if (args.where.id === "a") {
        return recipe("a", [{ componentRecipeId: "b", quantity: 1, unit: "serving" }])
      }
      if (args.where.id === "b") {
        return recipe("b", [{ componentRecipeId: "a", quantity: 1, unit: "serving" }])
      }
      return null
    }) as never)
    await expect(walkRecipeForIngredient("a", "target", "oz")).rejects.toBeInstanceOf(
      RecipeWalkCycleError
    )
  })
})
