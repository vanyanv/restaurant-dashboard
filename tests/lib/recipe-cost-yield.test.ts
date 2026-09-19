// The two bugs that made a recipe's cost a number nobody could trust, and the
// property that makes fixing them safe to ship.
//
//  1. A sub-recipe line was `sub.totalCost * ing.quantity` with the unit
//     stored, displayed, and never read — so "2 oz of house sauce" charged two
//     entire batches, and `partial` stayed false so every page reported the
//     plate as fully costed.
//  2. `servingSize` was selected by the walk and never divided by, so a batch
//     total was handed to COGS as a plate cost.
//
// Both were dormant in the live data: every recipe in the account yields 1 and
// every sub-recipe line counts servings. The LAST test here is the one that
// says shipping this moves nothing — it pins that shape to the figures it
// produced before the change.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: { recipe: { findUnique: vi.fn(), findMany: vi.fn() } },
}))
vi.mock("@/lib/canonical-ingredients", () => ({
  getCanonicalIngredientCost: vi.fn(),
}))

import { prisma } from "@/lib/prisma"
import { getCanonicalIngredientCost } from "@/lib/canonical-ingredients"
import { computeRecipeCost } from "@/lib/recipe-cost"

const findUnique = vi.mocked(prisma.recipe.findUnique)
const getCost = vi.mocked(getCanonicalIngredientCost)

type Line = {
  id?: string
  quantity: number
  unit: string
  canonicalIngredientId?: string | null
  componentRecipeId?: string | null
  name?: string
}

function line(l: Line) {
  return {
    id: l.id ?? "ri",
    quantity: l.quantity,
    unit: l.unit,
    ingredientName: l.name ?? null,
    canonicalIngredientId: l.canonicalIngredientId ?? null,
    componentRecipeId: l.componentRecipeId ?? null,
    canonicalIngredient: l.canonicalIngredientId
      ? { id: l.canonicalIngredientId, name: l.name ?? l.canonicalIngredientId }
      : null,
    componentRecipe: l.componentRecipeId
      ? { id: l.componentRecipeId, itemName: l.name ?? l.componentRecipeId }
      : null,
  }
}

function recipe(over: {
  id: string
  itemName?: string
  servingSize?: number
  yieldUnit?: string | null
  foodCostOverride?: number | null
  lines?: Line[]
}) {
  return {
    id: over.id,
    itemName: over.itemName ?? over.id,
    servingSize: over.servingSize ?? 1,
    yieldUnit: over.yieldUnit ?? null,
    foodCostOverride: over.foodCostOverride ?? null,
    ingredients: (over.lines ?? []).map(line),
  }
}

function price(unitCost: number, unit: string, yieldFactor = 1) {
  return {
    unitCost,
    unit,
    source: "invoice" as const,
    asOfDate: new Date("2026-09-10"),
    sourceInvoiceId: "inv-1",
    sourceLineItemId: "li-1",
    sourceVendor: "Sysco",
    sourceSku: "4471820",
    sourceProductName: "Product",
    yieldFactor,
  }
}

/** Serve a set of recipes to the walk by id. */
function serve(rows: ReturnType<typeof recipe>[]) {
  const byId = new Map(rows.map((r) => [r.id, r]))
  findUnique.mockImplementation((async (args: { where: { id: string } }) =>
    byId.get(args.where.id) ?? null) as never)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("a batch recipe's yield is divided out", () => {
  it("a 24-portion batch of chili costs $2.00 a bowl, not $48.00", async () => {
    serve([
      recipe({
        id: "chili",
        itemName: "Chili",
        servingSize: 24,
        lines: [{ canonicalIngredientId: "beef", quantity: 12, unit: "lb", name: "Ground beef" }],
      }),
    ])
    getCost.mockResolvedValue(price(4, "lb"))

    const r = await computeRecipeCost("chili")
    expect(r.batchCost).toBe(48)
    expect(r.totalCost).toBe(2)
    expect(r.servingSize).toBe(24)
  })

  it("a yield of zero or nonsense falls back to 1 rather than dividing to Infinity", async () => {
    serve([
      recipe({
        id: "bad",
        servingSize: 0,
        lines: [{ canonicalIngredientId: "beef", quantity: 1, unit: "lb" }],
      }),
    ])
    getCost.mockResolvedValue(price(4, "lb"))

    const r = await computeRecipeCost("bad")
    expect(r.totalCost).toBe(4)
    expect(Number.isFinite(r.totalCost)).toBe(true)
  })
})

describe("a sub-recipe line draws a measured share of the batch", () => {
  const sauce = recipe({
    id: "sauce",
    itemName: "House Sauce",
    servingSize: 128,
    yieldUnit: "fl oz",
    lines: [{ canonicalIngredientId: "mayo", quantity: 1, unit: "gal", name: "Mayonnaise" }],
  })

  it("2 fl oz of a 128 fl oz batch costs 1/64th of it", async () => {
    serve([
      sauce,
      recipe({
        id: "burger",
        lines: [{ componentRecipeId: "sauce", quantity: 2, unit: "fl oz", name: "House Sauce" }],
      }),
    ])
    getCost.mockResolvedValue(price(30, "gal"))

    const r = await computeRecipeCost("burger")
    // The batch is $30. 2 of its 128 fl oz is $0.46875.
    expect(r.totalCost).toBeCloseTo(0.46875, 6)
    expect(r.partial).toBe(false)
    expect(r.lines[0].qtyInYieldUnit).toBe(2)
    // This is the number the old walk returned for the same recipe.
    expect(r.totalCost).not.toBeCloseTo(60, 2)
  })

  it("converts across the family — a cup out of a fl oz batch", async () => {
    serve([
      sauce,
      recipe({
        id: "tray",
        lines: [{ componentRecipeId: "sauce", quantity: 1, unit: "cup", name: "House Sauce" }],
      }),
    ])
    getCost.mockResolvedValue(price(30, "gal"))

    const r = await computeRecipeCost("tray")
    // 1 cup is 8 fl oz, so 8/128 of $30.
    expect(r.totalCost).toBeCloseTo(1.875, 6)
    expect(r.lines[0].qtyInYieldUnit).toBeCloseTo(8, 6)
  })

  it("REFUSES a line it cannot measure instead of charging the whole batch", async () => {
    serve([
      sauce,
      recipe({
        id: "weird",
        lines: [{ componentRecipeId: "sauce", quantity: 2, unit: "lb", name: "House Sauce" }],
      }),
    ])
    getCost.mockResolvedValue(price(30, "gal"))

    const r = await computeRecipeCost("weird")
    expect(r.totalCost).toBe(0)
    expect(r.partial).toBe(true)
    expect(r.lines[0].missingCost).toBe(true)
    expect(r.lines[0].missingReason).toBe("yield-mismatch")
    expect(r.lines[0].qtyInYieldUnit).toBeNull()
  })

  it("a portion-yield sub-recipe counts servings, whatever a legacy line calls them", async () => {
    const patty = recipe({
      id: "patty",
      itemName: "Beef Patty",
      lines: [{ canonicalIngredientId: "beef", quantity: 4, unit: "oz", name: "Ground beef" }],
    })
    serve([
      patty,
      recipe({ id: "double", lines: [{ componentRecipeId: "patty", quantity: 2, unit: "serving" }] }),
      recipe({ id: "odd", lines: [{ componentRecipeId: "patty", quantity: 2, unit: "gal" }] }),
    ])
    getCost.mockResolvedValue(price(0.25, "oz"))

    const ok = await computeRecipeCost("double")
    expect(ok.totalCost).toBe(2) // 2 × (4 oz × $0.25)
    expect(ok.partial).toBe(false)

    // NOT zero. `yieldUnit` is a new column with no backfill, so every
    // existing sub-recipe reads as portions and every existing line against
    // one would drop to $0.00 on the day this ships. The quantity is counted
    // as servings — what the old walk did with it — and `unitAssumed` says
    // the unit was not believed. See the group at the foot of this file.
    const bad = await computeRecipeCost("odd")
    expect(bad.totalCost).toBe(2)
    expect(bad.lines[0].missingCost).toBe(false)
    expect(bad.lines[0].unitAssumed).toBe(true)
  })

  it("a component recipe that has gone missing is one bad line, not a dead account", async () => {
    serve([recipe({ id: "plate", lines: [{ componentRecipeId: "gone", quantity: 1, unit: "serving" }] })])

    const r = await computeRecipeCost("plate")
    expect(r.totalCost).toBe(0)
    expect(r.partial).toBe(true)
    expect(r.lines[0].missingReason).toBe("unresolved")
  })
})

describe("an ingredient's usable yield raises what the line really costs", () => {
  it("a 0.8 yield on lettuce costs 25% more than the price sheet says", async () => {
    serve([
      recipe({
        id: "salad",
        lines: [{ canonicalIngredientId: "lettuce", quantity: 1, unit: "lb", name: "Lettuce" }],
      }),
    ])
    getCost.mockResolvedValue(price(2, "lb", 0.8))

    const r = await computeRecipeCost("salad")
    expect(r.totalCost).toBeCloseTo(2.5, 6)
    expect(r.lines[0].yieldFactor).toBe(0.8)
  })

  it("the default of 1 changes nothing", async () => {
    serve([
      recipe({ id: "salad", lines: [{ canonicalIngredientId: "lettuce", quantity: 1, unit: "lb" }] }),
    ])
    getCost.mockResolvedValue(price(2, "lb", 1))
    expect((await computeRecipeCost("salad")).totalCost).toBe(2)
  })

  it("a yield outside (0, 1] is ignored rather than multiplying a plate cost", async () => {
    serve([
      recipe({ id: "salad", lines: [{ canonicalIngredientId: "lettuce", quantity: 1, unit: "lb" }] }),
    ])
    getCost.mockResolvedValue(price(2, "lb", 0))
    expect((await computeRecipeCost("salad")).totalCost).toBe(2)
  })
})

describe("the override is still a fallback, but it no longer hides what the lines came to", () => {
  it("a walk that produced a number keeps it, and says the override was not used", async () => {
    serve([
      recipe({
        id: "wings",
        foodCostOverride: 6,
        lines: [
          { id: "a", canonicalIngredientId: "salt", quantity: 1, unit: "oz", name: "Salt" },
          { id: "b", canonicalIngredientId: "wing", quantity: 10, unit: "each", name: "Wing" },
        ],
      }),
    ])
    getCost.mockImplementation((async (id: string) =>
      id === "salt" ? price(0.5, "oz") : null) as never)

    const r = await computeRecipeCost("wings")
    expect(r.totalCost).toBe(0.5)
    expect(r.overrideApplied).toBe(false)
    expect(r.partial).toBe(true)
  })

  it("a walk that produced nothing uses it, reports both figures, and says it HAS lines", async () => {
    serve([
      recipe({
        id: "wings",
        foodCostOverride: 6,
        lines: [{ canonicalIngredientId: "wing", quantity: 10, unit: "each" }],
      }),
    ])
    getCost.mockResolvedValue(null)

    const r = await computeRecipeCost("wings")
    expect(r.totalCost).toBe(6)
    expect(r.overrideApplied).toBe(true)
    expect(r.computedCost).toBe(0)
    // `emptyWalk` means "walked to nothing", which the catalogue printed as
    // "No lines". It has lines; they are the problem.
    expect(r.emptyWalk).toBe(true)
    expect(r.hasLines).toBe(true)
  })

  it("a recipe with no lines at all is the other case, and says so", async () => {
    serve([recipe({ id: "reverse-bun", foodCostOverride: 0, lines: [] })])
    const r = await computeRecipeCost("reverse-bun")
    expect(r.emptyWalk).toBe(true)
    expect(r.hasLines).toBe(false)
  })
})

describe("the live data's shape is untouched — this is what makes the change safe to ship", () => {
  it("yields 1, portions, no waste: every figure is what the old walk returned", async () => {
    serve([
      recipe({
        id: "fries",
        itemName: "Fries",
        lines: [{ canonicalIngredientId: "potato", quantity: 6, unit: "oz", name: "Potato" }],
      }),
      recipe({
        id: "combo",
        itemName: "Combo",
        lines: [
          { id: "a", componentRecipeId: "fries", quantity: 1, unit: "ea", name: "Fries" },
          { id: "b", canonicalIngredientId: "cup", quantity: 1, unit: "each", name: "Cup" },
        ],
      }),
    ])
    getCost.mockImplementation((async (id: string) =>
      id === "potato" ? price(0.06, "oz") : price(0.11, "each")) as never)

    const fries = await computeRecipeCost("fries")
    const combo = await computeRecipeCost("combo")

    // 6 oz × $0.06 = $0.36; the combo adds an $0.11 cup.
    expect(fries.totalCost).toBeCloseTo(0.36, 6)
    expect(combo.totalCost).toBeCloseTo(0.47, 6)
    // Batch and per-serving agree, which is the whole reason the bug was
    // invisible on this account.
    expect(combo.batchCost).toBe(combo.totalCost)
    expect(combo.partial).toBe(false)
  })
})

/*
 * THE MIGRATION HAS NO BACKFILL, AND THAT IS THE WHOLE POINT OF THESE.
 *
 * `Recipe.yieldUnit` arrives NULL on every row in every existing account,
 * which means portions. A component line reading "2 oz" against one of those
 * is a unit that cannot be reconciled with a count — and refusing it would
 * take a figure that is WRONG today and make it $0.00 tomorrow, which is the
 * same understatement this change exists to remove, shipped as a migration.
 *
 * So the walk counts it as servings, which is exactly what the old walk did
 * with it, and flags the line. Nothing moves the day this ships. The SAVE
 * path still refuses the same line, because there somebody is present to fix
 * it — the two rules differ on purpose and these tests hold both.
 */
describe("a legacy line against a portions recipe keeps the cost it has today", () => {
  const patty = recipe({
    id: "patty",
    itemName: "Beef Patty",
    servingSize: 1,
    yieldUnit: null,
    lines: [{ canonicalIngredientId: "beef", quantity: 0.25, unit: "lb", name: "Ground beef" }],
  })

  it("counts an unmeasurable unit as servings rather than zeroing the line", async () => {
    serve([
      patty,
      recipe({
        id: "burger",
        itemName: "Double Burger",
        lines: [{ componentRecipeId: "patty", quantity: 2, unit: "oz", name: "Beef Patty" }],
      }),
    ])
    getCost.mockResolvedValue(price(4, "lb"))

    const r = await computeRecipeCost("burger")
    // One patty costs $1.00; the line asks for 2, however it labels them.
    expect(r.totalCost).toBe(2)
    expect(r.lines[0].missingCost).toBe(false)
    expect(r.partial).toBe(false)
  })

  it("says the unit was not believed, so the page can offer the one-field fix", async () => {
    serve([
      patty,
      recipe({
        id: "burger",
        lines: [{ componentRecipeId: "patty", quantity: 2, unit: "oz" }],
      }),
    ])
    getCost.mockResolvedValue(price(4, "lb"))

    const r = await computeRecipeCost("burger")
    expect(r.lines[0].unitAssumed).toBe(true)
  })

  it("does not flag a line that genuinely counts servings", async () => {
    serve([
      patty,
      recipe({
        id: "burger",
        lines: [{ componentRecipeId: "patty", quantity: 2, unit: "serving" }],
      }),
    ])
    getCost.mockResolvedValue(price(4, "lb"))

    const r = await computeRecipeCost("burger")
    expect(r.lines[0].unitAssumed).toBe(false)
    expect(r.totalCost).toBe(2)
  })

  it("still refuses an unmeasurable unit against a MEASURED batch, where nothing legacy exists", async () => {
    serve([
      recipe({
        id: "sauce",
        itemName: "House Sauce",
        servingSize: 128,
        yieldUnit: "fl oz",
        lines: [{ canonicalIngredientId: "base", quantity: 1, unit: "gal", name: "Sauce base" }],
      }),
      recipe({
        id: "burger",
        lines: [{ componentRecipeId: "sauce", quantity: 2, unit: "lb" }],
      }),
    ])
    getCost.mockResolvedValue(price(30, "gal"))

    const r = await computeRecipeCost("burger")
    expect(r.lines[0].missingCost).toBe(true)
    expect(r.lines[0].missingReason).toBe("yield-mismatch")
    expect(r.totalCost).toBe(0)
  })
})
