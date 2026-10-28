// startMenuItem — the New menu item screen's one write.
//
// Pinned: copying reads the source inside the caller's account only; a POS
// start maps the name; a failure after the recipe exists still returns its id
// so the screen can open it rather than strand it.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: { recipe: { findFirst: vi.fn() } } }))
vi.mock("@/lib/auth-scope", () => ({ getAuthScope: vi.fn() }))
vi.mock("@/app/actions/menu-item-actions", () => ({ mapOtterItemToRecipe: vi.fn() }))
vi.mock("@/lib/counter/actions/recipe", () => ({ createRecipe: vi.fn(), saveRecipeLines: vi.fn() }))

import { prisma } from "@/lib/prisma"
import { getAuthScope } from "@/lib/auth-scope"
import { mapOtterItemToRecipe } from "@/app/actions/menu-item-actions"
import { createRecipe, saveRecipeLines } from "@/lib/counter/actions/recipe"
import { startMenuItem } from "@/lib/counter/actions/menu-item"

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>
const LINES = [{ canonicalIngredientId: "ci_beef", componentRecipeId: null, ingredientName: null, quantity: 3, unit: "oz" }]

beforeEach(() => {
  vi.clearAllMocks()
  asMock(createRecipe).mockResolvedValue({ ok: true, recipeId: "r_new", error: null })
  asMock(saveRecipeLines).mockResolvedValue({ ok: true, error: null })
  asMock(getAuthScope).mockResolvedValue({ accountId: "acc_1", ownerId: "u_1" })
  asMock(prisma.recipe.findFirst).mockResolvedValue({ ingredients: LINES })
  asMock(mapOtterItemToRecipe).mockResolvedValue(undefined)
})

describe("startMenuItem", () => {
  it("creates a blank recipe", async () => {
    const r = await startMenuItem({ itemName: "Fish Slider", category: "Sliders" })
    expect(r).toEqual({ ok: true, recipeId: "r_new", error: null })
    expect(saveRecipeLines).not.toHaveBeenCalled()
    expect(mapOtterItemToRecipe).not.toHaveBeenCalled()
  })

  it("copies a dish's lines, reading it inside the caller's account", async () => {
    const r = await startMenuItem({ itemName: "Reverse Bun", category: "Sliders", copyFrom: "r_double" })
    expect(r.ok).toBe(true)
    expect(asMock(prisma.recipe.findFirst).mock.calls[0][0].where).toEqual({ id: "r_double", accountId: "acc_1" })
    expect(saveRecipeLines).toHaveBeenCalledWith({ recipeId: "r_new", lines: LINES })
  })

  it("does not copy a recipe from another account, but still returns the new id", async () => {
    asMock(prisma.recipe.findFirst).mockResolvedValue(null)
    const r = await startMenuItem({ itemName: "X", category: "Sliders", copyFrom: "r_other" })
    expect(r).toMatchObject({ ok: false, recipeId: "r_new" })
    expect(saveRecipeLines).not.toHaveBeenCalled()
  })

  it("maps the POS name when starting from something already selling", async () => {
    const r = await startMenuItem({ itemName: "CVT Ice Cream", category: "Desserts", posName: "CVT Ice Cream" })
    expect(r.ok).toBe(true)
    expect(mapOtterItemToRecipe).toHaveBeenCalledWith({ otterItemName: "CVT Ice Cream", recipeId: "r_new" })
  })

  it("returns the create error when the name is taken", async () => {
    asMock(createRecipe).mockResolvedValue({ ok: false, recipeId: null, error: "A recipe with that name already exists" })
    const r = await startMenuItem({ itemName: "Double Slider", category: "Sliders" })
    expect(r).toMatchObject({ ok: false, recipeId: null })
  })
})
