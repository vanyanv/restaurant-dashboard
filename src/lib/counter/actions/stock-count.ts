"use server"

import { startOrResumeStockCount } from "@/app/actions/inventory/count-entry-actions"

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
