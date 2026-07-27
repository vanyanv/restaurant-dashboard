// computeRecipeCost × cost-guard propagation: when getCanonicalIngredientCost
// falls back to an older price (costGuardTriggered), the recipe result must be
// flagged partial — that's what routes the suspect invoice line into the COGS
// data-quality panel via DailyCogsItem.partialCost.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: { recipe: { findUnique: vi.fn() } },
}))
vi.mock("@/lib/canonical-ingredients", () => ({
  getCanonicalIngredientCost: vi.fn(),
}))

import { prisma } from "@/lib/prisma"
import { getCanonicalIngredientCost } from "@/lib/canonical-ingredients"
import { computeRecipeCost } from "@/lib/recipe-cost"

const recipeRow = {
  id: "r-1",
  itemName: "Double Slider",
  servingSize: 1,
  foodCostOverride: null,
  ingredients: [
    {
      id: "ri-1",
      quantity: 4,
      unit: "oz",
      ingredientName: "Beef",
      canonicalIngredientId: "can-beef",
      componentRecipeId: null,
      canonicalIngredient: { id: "can-beef", name: "Ground Beef" },
      componentRecipe: null,
    },
  ],
}

function ingredientCost(overrides: Record<string, unknown> = {}) {
  return {
    unitCost: 0.5,
    unit: "oz",
    source: "invoice",
    asOfDate: new Date("2026-07-12"),
    sourceInvoiceId: "inv-1",
    sourceLineItemId: "line-1",
    sourceVendor: "Sysco",
    sourceSku: null,
    sourceProductName: "Ground Beef",
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.recipe.findUnique).mockResolvedValue(recipeRow as never)
})

describe("computeRecipeCost — cost guard propagation", () => {
  it("flags the result partial when the ingredient cost came from a guard fallback", async () => {
    vi.mocked(getCanonicalIngredientCost).mockResolvedValue(
      ingredientCost({ costGuardTriggered: true }) as never
    )

    const result = await computeRecipeCost("r-1")

    expect(result.totalCost).toBeCloseTo(2) // 0.5 × 4 — cost still usable
    expect(result.partial).toBe(true) // …but flagged for the data-quality panel
    expect(result.lines[0].missingCost).toBe(false)
  })

  it("stays non-partial for a clean ingredient cost", async () => {
    vi.mocked(getCanonicalIngredientCost).mockResolvedValue(
      ingredientCost({ costGuardTriggered: false }) as never
    )

    const result = await computeRecipeCost("r-1")

    expect(result.totalCost).toBeCloseTo(2)
    expect(result.partial).toBe(false)
  })
})
