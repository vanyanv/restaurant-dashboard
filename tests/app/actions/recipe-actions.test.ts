// Security contracts for upsertRecipe (2026-06-12 audit, Tier 1):
//  1. The update path must scope by accountId — a recipe id from another
//     account is "Recipe not found", with nothing written (IDOR fix).
//  2. The cycle check runs INSIDE the transaction, so a RecipeCycleError
//     rolls the whole write back. The old code checked after commit and
//     compensated with prisma.recipe.delete — which destroyed pre-existing
//     recipes on the update path. That delete must never happen.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth-scope", () => ({ getAuthScope: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/cached", () => ({
  costRecipeCached: vi.fn(),
  costIngredientCached: vi.fn(),
}))
vi.mock("@/lib/recipe-cost-batch", () => ({ batchRecipeCosts: vi.fn() }))
vi.mock("@/lib/menu-sell-price", () => ({ resolveSellPriceForRecipe: vi.fn() }))
vi.mock("@/app/actions/menu-item-actions", () => ({
  getMenuItemSellPrices: vi.fn(),
  getMenuItemsForCatalog: vi.fn(),
}))
vi.mock("@/lib/recipe-cost", () => {
  class RecipeCycleError extends Error {
    constructor(public cycle: string[] = []) {
      super(`Recipe cycle detected: ${cycle.join(" -> ")}`)
      this.name = "RecipeCycleError"
    }
  }
  return {
    RecipeCycleError,
    assertNoCycles: vi.fn(),
    computeRecipeCost: vi.fn(),
    computeIngredientLineCost: vi.fn(),
  }
})
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(),
    recipe: { delete: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    recipeIngredient: { findFirst: vi.fn() },
  },
}))

import { prisma } from "@/lib/prisma"
import { assertNoCycles, RecipeCycleError } from "@/lib/recipe-cost"
import { getAuthScope } from "@/lib/auth-scope"
import { upsertRecipe } from "@/app/actions/recipe-actions"
import type { RecipeInput } from "@/types/recipe"

// Transaction client mock handed to the $transaction callback.
const tx = {
  recipe: { update: vi.fn(), create: vi.fn(), findFirst: vi.fn() },
  recipeIngredient: { deleteMany: vi.fn(), createMany: vi.fn() },
}

const baseInput: RecipeInput = {
  itemName: "Smash Burger",
  category: "Mains",
  servingSize: 1,
  isSellable: true,
  ingredients: [
    { canonicalIngredientId: "ci-1", quantity: 2, unit: "oz" },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAuthScope).mockResolvedValue({ ownerId: "u1", accountId: "acct-A" } as never)
  vi.mocked(prisma.$transaction).mockImplementation((async (cb: (t: typeof tx) => Promise<unknown>) =>
    cb(tx)) as never)
  vi.mocked(assertNoCycles).mockResolvedValue(undefined)
  tx.recipe.findFirst.mockResolvedValue({ id: "r1" })
  tx.recipe.update.mockResolvedValue({ id: "r1" })
  tx.recipe.create.mockResolvedValue({ id: "r-new" })
  tx.recipeIngredient.deleteMany.mockResolvedValue({ count: 0 })
  tx.recipeIngredient.createMany.mockResolvedValue({ count: 1 })
})

describe("upsertRecipe — account scoping (IDOR)", () => {
  it("rejects an update for a recipe id outside the caller's account, writing nothing", async () => {
    tx.recipe.findFirst.mockResolvedValue(null) // foreign or nonexistent id

    await expect(
      upsertRecipe({ ...baseInput, id: "r-foreign" }),
    ).rejects.toThrow("Recipe not found")

    expect(tx.recipe.update).not.toHaveBeenCalled()
    expect(tx.recipeIngredient.deleteMany).not.toHaveBeenCalled()
    expect(tx.recipeIngredient.createMany).not.toHaveBeenCalled()
  })

  it("pre-checks ownership with the caller's accountId before updating", async () => {
    const result = await upsertRecipe({ ...baseInput, id: "r1" })

    expect(result).toEqual({ id: "r1" })
    expect(tx.recipe.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "r1", accountId: "acct-A" }),
      }),
    )
    expect(tx.recipe.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "r1" } }),
    )
  })

  it("creates new recipes under the caller's owner + account", async () => {
    const result = await upsertRecipe(baseInput)

    expect(result).toEqual({ id: "r-new" })
    expect(tx.recipe.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ownerId: "u1", accountId: "acct-A" }),
      }),
    )
  })
})

describe("upsertRecipe — cycle check rollback (no compensating delete)", () => {
  it("runs the cycle check inside the transaction and never deletes the recipe on a cycle", async () => {
    vi.mocked(assertNoCycles).mockRejectedValue(new RecipeCycleError(["r1", "r2", "r1"]))

    await expect(
      upsertRecipe({ ...baseInput, id: "r1" }),
    ).rejects.toThrow(RecipeCycleError)

    // The check must see the uncommitted writes — it gets the tx client.
    expect(assertNoCycles).toHaveBeenCalledWith("r1", tx)
    // The old post-commit compensation deleted a pre-existing recipe on the
    // update path. The rollback makes that delete unnecessary and forbidden.
    expect(prisma.recipe.delete).not.toHaveBeenCalled()
  })
})
