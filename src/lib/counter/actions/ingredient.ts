"use server"

import { updateCanonicalCost } from "@/app/actions/canonical-ingredient-actions"

/**
 * The Counter layer's write path for one canonical ingredient — same shape as
 * `./invoice.ts`, `./alert.ts`, `./decision.ts`, `./store.ts`, `./recipe.ts`,
 * `./stock-count.ts` and `./settings.ts`.
 *
 * See `costOf` in `@/lib/counter/adapters/ingredient` for why the owner needs
 * this: `costPerRecipeUnit` is derived from invoice pack metadata, that parse
 * fails in a way that inflates $/unit by ten to two hundred times, and the
 * error propagates through every recipe into COGS. `selectNonSpikeCostIndex`
 * hides the spike from the figures; nothing fixed the stored number, and the
 * editorial ingredient sheet's form for doing so was dropped in the rebuild.
 *
 * `updateCanonicalCost` throws rather than returning a result union, which is
 * the older convention in `@/app/actions`. The catch is here so the Counter
 * clients keep the one `{ ok }` shape they all branch on.
 */
export async function saveIngredientCost(input: {
  ingredientId: string
  costPerRecipeUnit: number | null
  recipeUnit: string | null
  costLocked: boolean
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await updateCanonicalCost({
      canonicalIngredientId: input.ingredientId,
      costPerRecipeUnit: input.costPerRecipeUnit,
      // A blank unit clears it; the action reads null as "clear" and absent as
      // "unchanged", and this form always sends both fields together because
      // a price without its unit is the bug it exists to fix.
      recipeUnit: input.recipeUnit,
      costLocked: input.costLocked,
    })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "save failed" }
  }
}
