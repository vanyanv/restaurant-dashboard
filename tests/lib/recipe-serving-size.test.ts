// A recipe entered as a batch, and what one plate of it costs.
//
// `Recipe.servingSize` is "portions yielded per recipe". Both walks in
// `recipe-cost.ts` and the one in `recipe-cost-batch.ts` selected it and none
// of them divided by it, so a recipe whose ingredients are scaled to the whole
// batch reported the WHOLE BATCH as the plate cost — straight into COGS and
// every food-cost percentage above it.
//
// It survived because all 60 production recipes sit at `servingSize = 1`. The
// `recipe_serving_size_positive` CHECK constraint was added in the 2026-05-02
// migration explicitly so "a divide-by-servingSize consumer can't end up with
// Infinity/NaN". This is that consumer, finally wired up.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: { recipe: { findMany: vi.fn() } },
}))
vi.mock("@/lib/canonical-cost-batch", () => ({ batchCanonicalCosts: vi.fn() }))

import { prisma } from "@/lib/prisma"
import { batchCanonicalCosts } from "@/lib/canonical-cost-batch"
import { batchRecipeCosts } from "@/lib/recipe-cost"
import { batchRecipeCosts as leanBatch } from "@/lib/recipe-cost-batch"

/** Two pounds of beef at $5/lb — a $10 batch, however it is portioned. */
function recipe(id: string, servingSize: number, foodCostOverride: number | null = null) {
  return {
    id,
    itemName: id,
    servingSize,
    foodCostOverride,
    ingredients: [
      {
        id: `${id}-i1`,
        quantity: 2,
        unit: "lb",
        ingredientName: "Ground beef",
        canonicalIngredientId: "ci_beef",
        componentRecipeId: null,
        canonicalIngredient: { id: "ci_beef", name: "Ground beef" },
        componentRecipe: null,
      },
    ],
  }
}

const BEEF = new Map([
  [
    "ci_beef",
    {
      unitCost: 5,
      unit: "lb",
      source: "invoice" as const,
      asOfDate: new Date("2026-08-01"),
      sourceInvoiceId: null,
      sourceLineItemId: null,
      sourceVendor: null,
      sourceSku: null,
      sourceProductName: null,
      costGuardTriggered: false,
    },
  ],
])

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(batchCanonicalCosts).mockResolvedValue(BEEF as never)
})

describe("a batch recipe's plate cost", () => {
  it("divides the batch by the portions it yields", async () => {
    vi.mocked(prisma.recipe.findMany).mockResolvedValue([recipe("chili", 8)] as never)
    const chili = (await batchRecipeCosts("acct_1")).get("chili")!

    expect(chili.batchCost).toBe(10) // what the lines add up to
    expect(chili.totalCost).toBe(1.25) // what a bowl costs
    expect(chili.servingSize).toBe(8)
  })

  it("leaves a single-portion recipe exactly as it was", async () => {
    vi.mocked(prisma.recipe.findMany).mockResolvedValue([recipe("burger", 1)] as never)
    const burger = (await batchRecipeCosts("acct_1")).get("burger")!
    expect(burger.totalCost).toBe(10)
    expect(burger.batchCost).toBe(10)
  })

  it("does not divide a food-cost override, which is already a plate figure", async () => {
    // No ingredient lines to walk, so the override IS the answer.
    const bare = { ...recipe("slider", 6, 3.5), ingredients: [] }
    vi.mocked(prisma.recipe.findMany).mockResolvedValue([bare] as never)
    expect((await batchRecipeCosts("acct_1")).get("slider")!.totalCost).toBe(3.5)
  })

  it("falls back to one portion rather than dividing by nothing", async () => {
    vi.mocked(prisma.recipe.findMany).mockResolvedValue([recipe("odd", 0)] as never)
    const odd = (await batchRecipeCosts("acct_1")).get("odd")!
    expect(odd.totalCost).toBe(10)
    expect(Number.isFinite(odd.totalCost)).toBe(true)
  })
})

describe("the lean batch walk agrees about the same plate", () => {
  it("prices a bowl of chili the same as the full walk does", async () => {
    vi.mocked(prisma.recipe.findMany).mockResolvedValue([recipe("chili", 8)] as never)
    const lean = await leanBatch("acct_1", BEEF as never)
    expect(lean.get("chili")!.totalCost).toBe(1.25)
  })
})
