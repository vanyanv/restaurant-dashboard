// Typed costs are real numbers in a sane range (2026-11-20): an ingredient's
// cost per recipe unit and a recipe's food-cost override. And a recipe save
// checks the session before it reads the recipe, scoped to the account.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/cache/cached", () => ({ bustTags: vi.fn() }))
vi.mock("@/lib/auth-scope", () => ({ getAuthScope: vi.fn(), getSession: vi.fn() }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    canonicalIngredient: { findFirst: vi.fn(), update: vi.fn() },
    recipe: { findFirst: vi.fn(), findUnique: vi.fn() },
  },
}))
vi.mock("@/app/actions/recipe-actions", () => ({
  upsertRecipe: vi.fn(async () => ({ id: "r1" })),
  confirmRecipe: vi.fn(),
  deleteRecipe: vi.fn(),
  previewRecipeCost: vi.fn(),
}))

import { prisma } from "@/lib/prisma"
import { getAuthScope } from "@/lib/auth-scope"
import { upsertRecipe } from "@/app/actions/recipe-actions"
import { saveIngredientCost } from "@/lib/counter/actions/ingredient"
import { saveRecipeLines } from "@/lib/counter/actions/recipe"
import { typedCostError, MAX_TYPED_COST } from "@/lib/cost-input"

const m = <T>(f: T) => f as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  m(getAuthScope).mockResolvedValue({ ownerId: "u1", accountId: "a1" })
  m(prisma.canonicalIngredient.findFirst).mockResolvedValue({ id: "i1" })
  m(prisma.recipe.findFirst).mockResolvedValue({
    itemName: "Burger", category: "Mains", servingSize: 1, notes: null,
    isSellable: true, foodCostOverride: null, yieldUnit: null,
  })
})

describe("typedCostError", () => {
  it("accepts zero through the ceiling", () => {
    for (const ok of [0, 0.01, 2.45, MAX_TYPED_COST]) expect(typedCostError(ok)).toBeNull()
  })
  it("refuses negative, non-finite, non-number and absurd", () => {
    for (const bad of [-0.01, Number.NaN, Infinity, -Infinity, "2.45", MAX_TYPED_COST + 0.01]) {
      expect(typedCostError(bad)).toEqual(expect.any(String))
    }
  })
})

describe("saveIngredientCost", () => {
  it.each([-1, Number.NaN, Infinity, 50_000])("refuses %s with a plain sentence and writes nothing", async (cost) => {
    const r = await saveIngredientCost({ ingredientId: "i1", costPerRecipeUnit: cost, recipeUnit: "lb", costLocked: false })
    expect(r.ok).toBe(false)
    expect(r).toMatchObject({ error: expect.not.stringMatching(/prisma|undefined/i) })
    expect(prisma.canonicalIngredient.update).not.toHaveBeenCalled()
  })

  it("saves a real cost, and a cleared one", async () => {
    expect(await saveIngredientCost({ ingredientId: "i1", costPerRecipeUnit: 2.45, recipeUnit: "lb", costLocked: false })).toEqual({ ok: true })
    expect(await saveIngredientCost({ ingredientId: "i1", costPerRecipeUnit: null, recipeUnit: null, costLocked: false })).toEqual({ ok: true })
    expect(prisma.canonicalIngredient.update).toHaveBeenCalledTimes(2)
  })
})

describe("saveRecipeLines", () => {
  it("reads nothing when signed out", async () => {
    m(getAuthScope).mockResolvedValue(null)
    const r = await saveRecipeLines({ recipeId: "r1", lines: [] })
    expect(r.ok).toBe(false)
    expect(prisma.recipe.findFirst).not.toHaveBeenCalled()
    expect(prisma.recipe.findUnique).not.toHaveBeenCalled()
  })

  it("reads the recipe scoped to the caller's account", async () => {
    expect(await saveRecipeLines({ recipeId: "r1", lines: [] })).toEqual({ ok: true, error: null })
    expect(m(prisma.recipe.findFirst).mock.calls[0][0].where).toEqual({ id: "r1", accountId: "a1" })
  })

  it("another account's recipe reads as gone and is not written", async () => {
    m(prisma.recipe.findFirst).mockResolvedValue(null)
    expect(await saveRecipeLines({ recipeId: "r-other", lines: [] })).toEqual({ ok: false, error: "That recipe no longer exists." })
    expect(upsertRecipe).not.toHaveBeenCalled()
  })

  it.each([-5, Number.NaN, 1e9])("refuses a food-cost override of %s", async (o) => {
    const r = await saveRecipeLines({ recipeId: "r1", lines: [], foodCostOverride: o })
    expect(r.ok).toBe(false)
    expect(upsertRecipe).not.toHaveBeenCalled()
  })
})
