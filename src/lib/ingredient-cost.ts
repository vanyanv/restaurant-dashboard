// Re-derives a canonical ingredient's `costPerRecipeUnit` from the latest
// matched invoice line item. Pure line-item math lives in
// `@/lib/invoice-line-shape` so it can be unit-tested without Prisma.

import { prisma } from "@/lib/prisma"
import {
  deriveCostFromLineItem,
  getLineItemBaseQty,
  type IngredientConversion,
  type LineItemForCost,
} from "@/lib/invoice-line-shape"

export {
  deriveCostFromLineItem,
  getLineItemBaseQty,
  type IngredientConversion,
  type LineItemForCost,
}

export type RecomputeResult =
  | { status: "updated"; before: number | null; after: number; unit: string }
  | { status: "unchanged"; reason: "locked" | "no-recipe-unit" | "no-match" | "no-derive" | "same-value" }

/**
 * Recompute a canonical ingredient's `costPerRecipeUnit` from the most recent
 * matched invoice line item.
 *
 * - Skips if `costLocked` is true.
 * - Skips if the canonical has no `recipeUnit` set (we don't know what to convert to).
 * - Skips if no matched line item exists yet.
 * - Otherwise updates cost + costSource="invoice" + costUpdatedAt=now.
 */
export async function recomputeCanonicalCost(
  canonicalId: string
): Promise<RecomputeResult> {
  const canonical = await prisma.canonicalIngredient.findUnique({
    where: { id: canonicalId },
    select: {
      id: true,
      recipeUnit: true,
      costPerRecipeUnit: true,
      costLocked: true,
      costSource: true,
    },
  })
  if (!canonical) return { status: "unchanged", reason: "no-match" }
  if (canonical.costLocked) return { status: "unchanged", reason: "locked" }
  if (!canonical.recipeUnit) return { status: "unchanged", reason: "no-recipe-unit" }

  // Most recent matched line item for this canonical. Returns (negative qty)
  // are eligible — they still establish a unit price for the ingredient.
  const line = await prisma.invoiceLineItem.findFirst({
    where: { canonicalIngredientId: canonicalId, quantity: { not: 0 } },
    orderBy: { invoice: { invoiceDate: "desc" } },
    select: {
      id: true,
      quantity: true,
      unit: true,
      packSize: true,
      unitSize: true,
      unitSizeUom: true,
      unitPrice: true,
      extendedPrice: true,
      invoice: { select: { vendorName: true } },
    },
  })
  if (!line) return { status: "unchanged", reason: "no-match" }

  // Per-ingredient conversion stored on the SKU match (future use for weird units).
  const vendorMatch = await prisma.ingredientSkuMatch.findFirst({
    where: { canonicalIngredientId: canonicalId },
    select: { conversionFactor: true, fromUnit: true, toUnit: true },
  })

  const derived = deriveCostFromLineItem(
    line,
    canonical.recipeUnit,
    vendorMatch
      ? {
          conversionFactor: vendorMatch.conversionFactor,
          fromUnit: vendorMatch.fromUnit,
          toUnit: vendorMatch.toUnit,
        }
      : undefined
  )
  if (derived == null) return { status: "unchanged", reason: "no-derive" }

  const before = canonical.costPerRecipeUnit
  // Avoid a spurious update when the value rounds to the same dollars.
  if (before != null && Math.abs(before - derived) < 1e-6) {
    return { status: "unchanged", reason: "same-value" }
  }

  await prisma.canonicalIngredient.update({
    where: { id: canonicalId },
    data: {
      costPerRecipeUnit: derived,
      costSource: "invoice",
      costUpdatedAt: new Date(),
    },
  })

  return {
    status: "updated",
    before,
    after: derived,
    unit: canonical.recipeUnit,
  }
}
