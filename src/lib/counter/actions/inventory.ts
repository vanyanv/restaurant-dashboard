"use server"

import { logInventoryAdjustment } from "@/app/actions/inventory/adjustment-actions"

/**
 * The Counter layer's write path for stock adjustments.
 *
 * See `InventoryAdjust` in `@/lib/counter/adapters/inventory` for why this
 * matters more than an empty table suggests: five separate consumers read
 * `InventoryAdjustment` and every one of them has been reading zero rows, so
 * every pound thrown away on this account has landed in food cost with no
 * cause attached to it.
 *
 * The quantity is always POSITIVE and the reason carries the direction —
 * `logInventoryAdjustment` rejects anything `<= 0`. An adjustment is "this
 * much left the shelf without being sold", so a negative would have to mean
 * stock appearing, which is a delivery and belongs on an invoice.
 */
export async function recordInventoryAdjustment(input: {
  storeId: string
  ingredientId: string
  qty: number
  reason: "THEFT" | "EXPIRY" | "SUPPLIER_RETURN" | "DAMAGE" | "OTHER"
  note: string | null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await logInventoryAdjustment({
    storeId: input.storeId,
    canonicalIngredientId: input.ingredientId,
    qty: input.qty,
    reason: input.reason,
    note: input.note,
  })
  if (result === null) return { ok: false, error: "not_signed_in" }
  if (!result.ok) return { ok: false, error: result.error }
  return { ok: true }
}
