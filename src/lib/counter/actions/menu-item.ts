"use server"

import { revalidatePath } from "next/cache"
import { mapOtterItemToRecipe } from "@/app/actions/menu-item-actions"
import { getAuthScope } from "@/lib/auth-scope"
import { prisma } from "@/lib/prisma"
import { createRecipe, saveRecipeLines } from "@/lib/counter/actions/recipe"

/**
 * Connect a sold menu item to the recipe that makes it.
 *
 * This is the join that makes a plate cost, a margin and a COGS attribution
 * possible. Measured on this account, and the window matters: of the 62 distinct
 * item names sold in the LAST 30 DAYS, 7 have no recipe. Over 90 days it is 20
 * of 75, and all-time it is 97 of 155 — but that last figure is mostly names
 * that stopped selling, so it describes the archive rather than the job.
 *
 * An unmapped item that is still selling costs nothing the product can see, so
 * it is missing from margin, from menu engineering, and from the food-cost
 * number the target is drawn against. Seven is a finishable afternoon; the
 * all-time 97 is not the same claim and should not be quoted as one.
 *
 * `mapOtterItemToRecipe` has always existed and the editorial recipe canvas
 * called it. The Counter item page's only control was a button reading "Map N
 * of these modifiers" that navigated to `/dashboard/recipes` and mapped
 * nothing.
 *
 * It upserts the mapping for EVERY store on the account, including inactive
 * ones, which is the action's own behaviour and the right one: an item name
 * belongs to the POS, not to a location, and a burger mapped at Hollywood but
 * not at Glendale would be costed in one place and free in the other.
 *
 * The underlying action throws; the catch is here so Counter clients keep the
 * one `{ ok }` shape they all branch on.
 */
export async function mapItemToRecipe(input: {
  otterItemName: string
  recipeId: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await mapOtterItemToRecipe(input)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "mapping failed" }
  }
}

/**
 * Start a menu item from the New menu item screen, in one click.
 *
 * Three starts, all ending on the new recipe's page:
 * - `posName` set: the dish is already selling under that POS name. The
 *   recipe is created and the name mapped for every store, so the next COGS
 *   run stops counting it as $0.
 * - `copyFrom` set: the new recipe gets a copy of that dish's lines (the
 *   source is read inside the caller's account; a recipe id from another
 *   account copies nothing).
 * - neither: a blank recipe.
 *
 * Creating, copying and mapping go through the existing actions, which scope
 * by account and validate the lines. If the recipe was created but a later
 * step failed, the id comes back WITH the error, so the screen can still open
 * the recipe and say what is left to do instead of leaving an orphan behind
 * a failure message.
 */
export async function startMenuItem(input: {
  itemName: string
  category: string
  copyFrom?: string | null
  posName?: string | null
}): Promise<{ ok: boolean; recipeId: string | null; error: string | null }> {
  const created = await createRecipe({ itemName: input.itemName, category: input.category })
  if (!created.ok || !created.recipeId) return created
  const recipeId = created.recipeId

  if (input.copyFrom) {
    const scope = await getAuthScope()
    const source = scope
      ? await prisma.recipe.findFirst({
          where: { id: input.copyFrom, accountId: scope.accountId },
          select: {
            ingredients: {
              select: { canonicalIngredientId: true, componentRecipeId: true, ingredientName: true, quantity: true, unit: true },
              orderBy: { createdAt: "asc" },
            },
          },
        })
      : null
    if (!source) return { ok: false, recipeId, error: "The dish to copy was not found, so the new item starts empty." }
    if (source.ingredients.length > 0) {
      const saved = await saveRecipeLines({ recipeId, lines: source.ingredients })
      if (!saved.ok) return { ok: false, recipeId, error: `Created, but the lines were not copied: ${saved.error}` }
    }
  }

  if (input.posName?.trim()) {
    const mapped = await mapItemToRecipe({ otterItemName: input.posName.trim(), recipeId })
    if (!mapped.ok) return { ok: false, recipeId, error: `Created, but not linked to the POS item: ${mapped.error}` }
  }

  revalidatePath("/dashboard/menu/items")
  return { ok: true, recipeId, error: null }
}

/**
 * Point a POS name that is selling with no recipe at a dish that already
 * exists ("Signature Slider" is the Double Slider). Same mapping as
 * {@link mapItemToRecipe}, plus a refresh of the Menu items list.
 */
export async function linkSellingItem(input: {
  otterItemName: string
  recipeId: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await mapItemToRecipe(input)
  if (result.ok) revalidatePath("/dashboard/menu/items")
  return result
}
