"use server"

import { mapOtterItemToRecipe } from "@/app/actions/menu-item-actions"

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
