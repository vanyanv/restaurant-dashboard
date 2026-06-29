// Re-derives a canonical ingredient's `costPerRecipeUnit` from the latest
// matched invoice line item. Pure line-item math lives in
// `@/lib/invoice-line-shape` so it can be unit-tested without Prisma.

import { prisma } from "@/lib/prisma"
import { logger } from "@/lib/logger"
import {
  COST_CANDIDATE_WINDOW,
  deriveCostFromLineItem,
  getLineItemBaseQty,
  selectNonSpikeCostIndex,
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

  // A window of recent matched lines (newest first), not just the latest, so
  // the spike guard has price history. Returns (negative qty) are eligible —
  // they still establish a unit price for the ingredient.
  const lines = await prisma.invoiceLineItem.findMany({
    where: { canonicalIngredientId: canonicalId, quantity: { not: 0 } },
    orderBy: { invoice: { invoiceDate: "desc" } },
    take: COST_CANDIDATE_WINDOW,
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
  if (lines.length === 0) return { status: "unchanged", reason: "no-match" }

  // Per-ingredient conversion stored on the SKU match (future use for weird units).
  const vendorMatch = await prisma.ingredientSkuMatch.findFirst({
    where: { canonicalIngredientId: canonicalId },
    select: { conversionFactor: true, fromUnit: true, toUnit: true },
  })
  const conv = vendorMatch
    ? {
        conversionFactor: vendorMatch.conversionFactor,
        fromUnit: vendorMatch.fromUnit,
        toUnit: vendorMatch.toUnit,
      }
    : undefined

  const resolved = lines
    .map((line) => ({
      line,
      cost: deriveCostFromLineItem(line, canonical.recipeUnit!, conv),
    }))
    .filter((r): r is { line: (typeof lines)[number]; cost: number } => r.cost != null)
  if (resolved.length === 0) return { status: "unchanged", reason: "no-derive" }

  const { index, rejectedSpike } = selectNonSpikeCostIndex(
    resolved.map((r) => r.cost)
  )
  const derived = resolved[index].cost
  if (rejectedSpike) {
    logger.warn(
      `[cost-guard] canonical ${canonicalId}: rejected spiked invoice cost ` +
        `$${resolved[0].cost.toFixed(2)} (line ${resolved[0].line.id}); ` +
        `storing $${derived.toFixed(2)} from an earlier in-tolerance line instead`
    )
  }

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
