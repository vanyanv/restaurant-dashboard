"use server"

import {
  getCountEntryData,
  startOrResumeStockCount,
} from "@/app/actions/inventory/count-entry-actions"
import {
  completeStockCount,
  saveStockCountLine,
} from "@/app/actions/inventory/stock-count-actions"

/**
 * The Counter layer's write path for stock counts — same shape as
 * `./recipe.ts`. A page may not import `@/app/actions/*`; this module is what
 * does, and the page talks only to the Counter layer. See `./recipe.ts` for
 * the full argument.
 *
 * One behaviour worth naming here rather than leaving in the underlying
 * action: `startOrResumeStockCount` RESUMES an open count on that store
 * instead of creating a second one, and returns `resumed: true` when it does.
 * The page surfaces which stores have an open count before the button is
 * pressed, so "start" never silently means "continue something from May".
 */
export async function beginStockCount(input: { storeId: string }): Promise<
  | { ok: true; stockCountId: string; resumed: boolean }
  | { ok: false; error: string }
> {
  const result = await startOrResumeStockCount({ storeId: input.storeId })
  if (result === null) return { ok: false, error: "not_signed_in" }
  if (!result.ok) return { ok: false, error: result.error }
  return { ok: true, stockCountId: result.stockCountId, resumed: result.resumed }
}

/**
 * WHAT THE COUNT SESSION PAGE NEEDS TO STOP BEING A DEAD END.
 *
 * `beginStockCount` above has been wired since the Counter inventory pages
 * were built, and it pushes the owner to
 * `/dashboard/operations/inventory/counts/<id>` — a page with no input on it.
 * You could start a count and then not count anything. That is worse than an
 * absent feature: it looks like a working one, and this account's three
 * attempts (all in May, the fullest of them ten lines of soda syrup) are what
 * a flow that dead-ends leaves behind.
 *
 * `saveStockCountLine` upserts per (count, ingredient), so re-entering a
 * number corrects it rather than doubling it, and the page can save on every
 * blur without inventing a dirty-tracking layer.
 *
 * `estimatedQtyAtCount` and the calibration factor are FROZEN at the moment
 * the count was opened — `getCountEntryData` hands them over per ingredient
 * and they travel back down with the line, because they are the training
 * target the model is later scored against. Recomputing them at save time
 * would score the model on a number it produced after seeing the answer.
 */
export interface CountEntryLine {
  ingredientId: string
  name: string
  category: string
  unit: string
  /** The model's estimate when the count opened. Null when it had no signal. */
  estimate: number | null
  /** What has already been entered for this ingredient on this count. */
  entered: number | null
}

export async function loadCountEntry(stockCountId: string): Promise<
  { ok: true; storeName: string; open: boolean; lines: CountEntryLine[] }
  | { ok: false; error: string }
> {
  const result = await getCountEntryData({ stockCountId })
  if (result === null) return { ok: false, error: "not_signed_in" }
  if (!result.ok) return { ok: false, error: result.error }
  return {
    ok: true,
    storeName: result.count.storeName,
    open: result.count.status === "IN_PROGRESS",
    lines: result.ingredients.map((i) => ({
      ingredientId: i.id,
      name: i.name,
      category: i.category,
      // The unit the number is IN. An ingredient with no recipe unit is
      // counted in whatever "each" means for it, which is what the entry form
      // shows rather than leaving the box unlabelled.
      unit: i.recipeUnit ?? "each",
      estimate: i.estimatedOnHand,
      entered: i.existingLine?.nativeQty ?? null,
    })),
  }
}

export async function recordCountLine(input: {
  stockCountId: string
  ingredientId: string
  qty: number
  unit: string
  estimate: number | null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await saveStockCountLine({
    stockCountId: input.stockCountId,
    canonicalIngredientId: input.ingredientId,
    nativeQty: input.qty,
    nativeUnit: input.unit,
    estimatedQtyAtCount: input.estimate,
  })
  if (result === null) return { ok: false, error: "not_signed_in" }
  if (!result.ok) return { ok: false, error: result.error }
  return { ok: true }
}

/**
 * Closing the count is what makes it count — literally. `StockCount.status`
 * has never once been COMPLETED on this account, and the inventory pages read
 * completed counts to calibrate the on-hand model, so every count ever taken
 * here has been invisible to the thing it exists to feed.
 */
export async function finishStockCount(
  stockCountId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await completeStockCount({ stockCountId })
  if (result === null) return { ok: false, error: "not_signed_in" }
  if (!result.ok) return { ok: false, error: result.error }
  return { ok: true }
}
