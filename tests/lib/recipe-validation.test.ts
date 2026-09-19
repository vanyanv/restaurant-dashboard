// `validateRecipeShape` is the gate both write paths now go through. Before it
// existed as a shared module there were two sets of rules: the edit path
// checked quantity, unit presence and the exactly-one-reference rule, and the
// AI-accept path — the only way an owner could create a recipe at all —
// checked nothing and wrote the model's output straight to createMany.
//
// The rules that are new, rather than merely shared:
//   · a line's unit must convert into what its ingredient is PRICED in, or the
//     line costs $0.00 on every recosting for the life of the recipe;
//   · a sub-recipe line must be measurable against that recipe's batch;
//   · an ingredient or sub-recipe from another account is refused — scoping
//     the recipe row by accountId never covered what it points AT.

import { describe, it, expect, vi, beforeEach } from "vitest"

import {
  validateRecipeShape,
  RecipeValidationError,
  type RecipeValidationDb,
} from "@/lib/recipe-validation"

const canonicalFindMany = vi.fn()
const recipeFindMany = vi.fn()

const db = {
  canonicalIngredient: { findMany: canonicalFindMany },
  recipe: { findMany: recipeFindMany },
} as unknown as RecipeValidationDb

const ACCOUNT = "acct-A"

beforeEach(() => {
  vi.clearAllMocks()
  canonicalFindMany.mockResolvedValue([])
  recipeFindMany.mockResolvedValue([])
})

/** Assert the call rejects, and return the owner-facing message. */
async function reason(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn()
  } catch (error) {
    expect(error).toBeInstanceOf(RecipeValidationError)
    return (error as Error).message
  }
  throw new Error("expected the shape to be rejected, and it was not")
}

describe("units that cannot convert are refused at save", () => {
  beforeEach(() => {
    canonicalFindMany.mockResolvedValue([{ id: "flour", name: "Flour", recipeUnit: "lb" }])
  })

  it("rejects cups against a price per pound, and names the units that would work", async () => {
    const message = await reason(() =>
      validateRecipeShape(
        { ingredients: [{ canonicalIngredientId: "flour", quantity: 2, unit: "cup" }] },
        ACCOUNT,
        db,
      ),
    )
    expect(message).toContain("Flour")
    expect(message).toContain("priced per lb")
    expect(message).toContain("cup")
    expect(message).toContain("lb, oz, kg or g")
  })

  it("accepts a unit in the same family", async () => {
    await expect(
      validateRecipeShape(
        { ingredients: [{ canonicalIngredientId: "flour", quantity: 4, unit: "oz" }] },
        ACCOUNT,
        db,
      ),
    ).resolves.toBeUndefined()
  })

  it("lets an ingredient with no recipe unit through — there is nothing to judge it against", async () => {
    canonicalFindMany.mockResolvedValue([{ id: "x", name: "Mystery", recipeUnit: null }])
    await expect(
      validateRecipeShape(
        { ingredients: [{ canonicalIngredientId: "x", quantity: 1, unit: "sleeve" }] },
        ACCOUNT,
        db,
      ),
    ).resolves.toBeUndefined()
  })
})

describe("sub-recipe lines are measured against the batch", () => {
  it("rejects a weight drawn out of a batch measured in fluid ounces", async () => {
    recipeFindMany.mockResolvedValue([
      { id: "sauce", itemName: "House Sauce", yieldUnit: "fl oz" },
    ])
    const message = await reason(() =>
      validateRecipeShape(
        { ingredients: [{ componentRecipeId: "sauce", quantity: 2, unit: "lb" }] },
        ACCOUNT,
        db,
      ),
    )
    expect(message).toContain("House Sauce")
    expect(message).toContain("fl oz")
  })

  it("accepts a volume that converts into it", async () => {
    recipeFindMany.mockResolvedValue([
      { id: "sauce", itemName: "House Sauce", yieldUnit: "fl oz" },
    ])
    await expect(
      validateRecipeShape(
        { ingredients: [{ componentRecipeId: "sauce", quantity: 1, unit: "cup" }] },
        ACCOUNT,
        db,
      ),
    ).resolves.toBeUndefined()
  })

  it("asks for servings when the sub-recipe yields portions", async () => {
    recipeFindMany.mockResolvedValue([{ id: "patty", itemName: "Beef Patty", yieldUnit: null }])
    const message = await reason(() =>
      validateRecipeShape(
        { ingredients: [{ componentRecipeId: "patty", quantity: 2, unit: "gal" }] },
        ACCOUNT,
        db,
      ),
    )
    expect(message).toContain("counted in servings")

    await expect(
      validateRecipeShape(
        { ingredients: [{ componentRecipeId: "patty", quantity: 2, unit: "serving" }] },
        ACCOUNT,
        db,
      ),
    ).resolves.toBeUndefined()
  })
})

describe("tenancy — a recipe may not point at another account's things", () => {
  it("refuses an ingredient the account query did not return", async () => {
    canonicalFindMany.mockResolvedValue([])
    const message = await reason(() =>
      validateRecipeShape(
        { ingredients: [{ canonicalIngredientId: "someone-elses", quantity: 1, unit: "lb" }] },
        ACCOUNT,
        db,
      ),
    )
    expect(message).toContain("not in your pantry")
  })

  it("refuses a sub-recipe the account query did not return", async () => {
    const message = await reason(() =>
      validateRecipeShape(
        { ingredients: [{ componentRecipeId: "someone-elses", quantity: 1, unit: "serving" }] },
        ACCOUNT,
        db,
      ),
    )
    expect(message).toContain("not in this account")
  })

  it("scopes both lookups by the caller's accountId", async () => {
    canonicalFindMany.mockResolvedValue([{ id: "c", name: "C", recipeUnit: "lb" }])
    recipeFindMany.mockResolvedValue([{ id: "r", itemName: "R", yieldUnit: null }])
    await validateRecipeShape(
      {
        ingredients: [
          { canonicalIngredientId: "c", quantity: 1, unit: "lb" },
          { componentRecipeId: "r", quantity: 1, unit: "serving" },
        ],
      },
      ACCOUNT,
      db,
    )
    expect(canonicalFindMany.mock.calls[0][0].where.accountId).toBe(ACCOUNT)
    expect(recipeFindMany.mock.calls[0][0].where.accountId).toBe(ACCOUNT)
  })
})

describe("the rules that used to live only on the edit path", () => {
  it("rejects a quantity of zero", async () => {
    const message = await reason(() =>
      validateRecipeShape(
        { ingredients: [{ canonicalIngredientId: "c", quantity: 0, unit: "lb" }] },
        ACCOUNT,
        db,
      ),
    )
    expect(message).toContain("quantity above zero")
  })

  it("rejects a negative quantity, which would SUBTRACT from a plate cost", async () => {
    await reason(() =>
      validateRecipeShape(
        { ingredients: [{ canonicalIngredientId: "c", quantity: -4, unit: "lb" }] },
        ACCOUNT,
        db,
      ),
    )
  })

  it("rejects a line that is both an ingredient and a recipe, or neither", async () => {
    await reason(() =>
      validateRecipeShape(
        { ingredients: [{ canonicalIngredientId: "c", componentRecipeId: "r", quantity: 1, unit: "lb" }] },
        ACCOUNT,
        db,
      ),
    )
    await reason(() =>
      validateRecipeShape({ ingredients: [{ quantity: 1, unit: "lb" }] }, ACCOUNT, db),
    )
  })

  it("rejects a blank unit", async () => {
    const message = await reason(() =>
      validateRecipeShape(
        { ingredients: [{ canonicalIngredientId: "c", quantity: 1, unit: "  " }] },
        ACCOUNT,
        db,
      ),
    )
    expect(message).toContain("needs a unit")
  })
})

describe("the yield itself", () => {
  it("rejects a yield of zero", async () => {
    const message = await reason(() =>
      validateRecipeShape({ servingSize: 0, ingredients: [] }, ACCOUNT, db),
    )
    expect(message).toContain("above zero")
  })

  it("rejects a yield unit nothing could ever draw on", async () => {
    const message = await reason(() =>
      validateRecipeShape({ servingSize: 4, yieldUnit: "tray", ingredients: [] }, ACCOUNT, db),
    )
    expect(message).toContain("tray")
  })

  it("accepts a blank yield unit — that is how a recipe says it makes portions", async () => {
    await expect(
      validateRecipeShape({ servingSize: 24, yieldUnit: "", ingredients: [] }, ACCOUNT, db),
    ).resolves.toBeUndefined()
  })
})
