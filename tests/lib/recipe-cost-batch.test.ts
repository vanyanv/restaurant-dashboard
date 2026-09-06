// batchRecipeCosts is the listing-path variant of computeRecipeCost — used by
// adapters/orders.ts (via order-costs.ts's `costByRecipe.get(recipeId)`) and
// other list surfaces. Parity requirement: a recipe whose walk touches a
// graph cycle must be ABSENT from the returned map, exactly like
// recipe-cost.ts's computeRecipeCost/batchRecipeCosts, which catches
// RecipeCycleError and omits the recipe rather than pricing it at $0.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: { recipe: { findMany: vi.fn() } },
}))

import { prisma } from "@/lib/prisma"
import { batchRecipeCosts } from "@/lib/recipe-cost-batch"
import type { CanonicalIngredientCost } from "@/lib/canonical-ingredients"

type IngredientRow = {
  quantity: number
  unit: string
  canonicalIngredientId: string | null
  componentRecipeId: string | null
}

type RecipeRow = {
  id: string
  foodCostOverride: number | null
  ingredients: IngredientRow[]
}

function recipe(id: string, ingredients: IngredientRow[], foodCostOverride: number | null = null): RecipeRow {
  return { id, foodCostOverride, ingredients }
}

function componentLine(componentRecipeId: string, quantity = 1): IngredientRow {
  return { quantity, unit: "ea", canonicalIngredientId: null, componentRecipeId }
}

function canonicalLine(canonicalIngredientId: string, quantity = 1, unit = "lb"): IngredientRow {
  return { quantity, unit, canonicalIngredientId, componentRecipeId: null }
}

function canonicalCost(over: Partial<CanonicalIngredientCost> = {}): CanonicalIngredientCost {
  return {
    unitCost: 2,
    unit: "lb",
    source: "invoice",
    asOfDate: new Date("2026-08-01"),
    sourceInvoiceId: null,
    sourceLineItemId: null,
    sourceVendor: null,
    sourceSku: null,
    sourceProductName: null,
    costGuardTriggered: false,
    ...over,
  } as CanonicalIngredientCost
}

let warnSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
})

describe("batchRecipeCosts — cycle parity with the canonical walker", () => {
  it("omits a recipe whose walk touches a cycle, and still warns", async () => {
    vi.mocked(prisma.recipe.findMany).mockResolvedValue([
      recipe("r1", [componentLine("r2")]),
      recipe("r2", [componentLine("r1")]),
    ] as never)

    const map = await batchRecipeCosts("acct-1", new Map())

    expect(map.has("r1")).toBe(false)
    expect(map.has("r2")).toBe(false)
    expect(warnSpy).toHaveBeenCalled()
  })

  it("omits an ancestor whose subtree merely touches a cyclic recipe (parity with exception unwinding)", async () => {
    vi.mocked(prisma.recipe.findMany).mockResolvedValue([
      recipe("r1", [componentLine("r2")]),
      recipe("r2", [componentLine("r1")]),
      recipe("r3", [componentLine("r1")]),
    ] as never)

    const map = await batchRecipeCosts("acct-1", new Map())

    expect(map.has("r1")).toBe(false)
    expect(map.has("r2")).toBe(false)
    expect(map.has("r3")).toBe(false)
  })

  it("still prices an unrelated acyclic recipe normally", async () => {
    vi.mocked(prisma.recipe.findMany).mockResolvedValue([
      recipe("r1", [componentLine("r2")]),
      recipe("r2", [componentLine("r1")]),
      recipe("r4", [canonicalLine("c1", 3, "lb")]),
    ] as never)

    const canonicalCostMap = new Map([["c1", canonicalCost({ unitCost: 5, unit: "lb" })]])
    const map = await batchRecipeCosts("acct-1", canonicalCostMap)

    expect(map.has("r1")).toBe(false)
    expect(map.has("r2")).toBe(false)
    expect(map.get("r4")).toEqual({ totalCost: 15, partial: false })
  })

  it("keeps partial: true (not omission) for a recipe that merely contains an uncosted line", async () => {
    vi.mocked(prisma.recipe.findMany).mockResolvedValue([
      recipe("r5", [canonicalLine("missing-canonical", 1, "lb")]),
    ] as never)

    const map = await batchRecipeCosts("acct-1", new Map())

    expect(map.get("r5")).toEqual({ totalCost: 0, partial: true })
  })
})
