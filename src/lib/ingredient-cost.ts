// Derive a canonical ingredient's $/recipeUnit from an invoice line item.
//
// Invoice data shape we're normalizing:
//
//   quantity × packSize × unitSize = total base quantity in unitSizeUom (or `unit` if no pack/size)
//   extendedPrice / totalBaseQty   = cost per base unit
//
// Then convert cost-per-base-unit into cost-per-recipeUnit via the standard
// unit conversion (lb↔oz, gal↔fl oz, etc.). If those can't bridge the units,
// fall back to a per-ingredient factor from IngredientSkuMatch.

import { prisma } from "@/lib/prisma"
import { canonicalizeUnit, convert } from "@/lib/unit-conversion"

export type LineItemForCost = {
  quantity: number
  unit: string | null
  packSize: number | null
  unitSize: number | null
  unitSizeUom: string | null
  unitPrice: number
  extendedPrice: number
}

export type IngredientConversion = {
  /** Multiplier: 1 `fromUnit` of invoice-line base = `conversionFactor` `toUnit`. */
  conversionFactor: number
  fromUnit: string
  toUnit: string
}

/**
 * Normalize an invoice line item to a single $/recipeUnit number.
 *
 * Returns null when:
 *   - totalBaseQty is zero (bad data).
 *   - We can't bridge baseUom → recipeUnit via standard conversion AND no
 *     per-ingredient conversion factor was provided (or it doesn't match).
 */
export function deriveCostFromLineItem(
  line: LineItemForCost,
  recipeUnit: string,
  ingredientConv?: IngredientConversion
): number | null {
  // Treat 0 as null for pack/size — bad extraction shouldn't cause div-by-zero.
  // packSize / unitSize are always positive (no negative pack counts even on returns).
  const packSize = line.packSize && line.packSize > 0 ? line.packSize : 1
  const rawUnitSize = line.unitSize && line.unitSize > 0 ? line.unitSize : null
  const unitSize = rawUnitSize ?? 1
  const totalBaseQty = line.quantity * packSize * unitSize
  if (!isFinite(totalBaseQty) || totalBaseQty === 0) return null

  // Base UOM: prefer explicit unitSizeUom when we have a real unitSize, else
  // fall back to the order unit (e.g. unit=LB when bought loose by the pound,
  // or when unitSize is missing/bogus).
  const baseUom = (rawUnitSize ? line.unitSizeUom : null) ?? line.unit ?? line.unitSizeUom ?? ""
  if (!baseUom) return null

  // A coherent invoice line has matching signs on quantity and extendedPrice
  // (both positive for a purchase, both negative for a return). Mismatched
  // signs are bad data; bail rather than guess. Otherwise the abs() below
  // collapses both cases to the same positive $/unit.
  if (Math.sign(line.extendedPrice) !== Math.sign(totalBaseQty)) return null

  const costPerBase = Math.abs(line.extendedPrice) / Math.abs(totalBaseQty)
  if (!isFinite(costPerBase) || costPerBase <= 0) return null

  // Exact match (normalized): no conversion needed.
  const baseCanonical = canonicalizeUnit(baseUom)
  const recipeCanonical = canonicalizeUnit(recipeUnit)
  if (baseCanonical && recipeCanonical && baseCanonical === recipeCanonical) {
    return costPerBase
  }

  // Standard within-category conversion (lb↔oz, gal↔fl oz, each↔dz, etc.).
  // If baseUom is `lb` and recipeUnit is `oz`, then 1 lb = 16 oz, so
  // cost/oz = cost/lb ÷ 16  →  cost/recipeUnit = costPerBase ÷ convert(1, recipeUnit, baseUom).
  if (baseCanonical && recipeCanonical) {
    const baseUnitsPerRecipeUnit = convert(1, recipeUnit, baseUom)
    if (baseUnitsPerRecipeUnit != null && baseUnitsPerRecipeUnit > 0) {
      return costPerBase * baseUnitsPerRecipeUnit
    }
  }

  // Per-ingredient conversion (e.g. "1 head → 15 leaves" or "1 gal oil → 128 fl oz").
  // Convention: conversionFactor = how many `toUnit` are in 1 `fromUnit`.
  // We use it when baseUom matches fromUnit and recipeUnit matches toUnit (or vice versa).
  if (ingredientConv && ingredientConv.conversionFactor > 0) {
    const from = canonicalizeUnit(ingredientConv.fromUnit) ?? ingredientConv.fromUnit.toLowerCase().trim()
    const to = canonicalizeUnit(ingredientConv.toUnit) ?? ingredientConv.toUnit.toLowerCase().trim()
    const baseToken = baseCanonical ?? baseUom.toLowerCase().trim()
    const recipeToken = recipeCanonical ?? recipeUnit.toLowerCase().trim()
    if (from === baseToken && to === recipeToken) {
      // cost per base ÷ (recipe units per 1 base) = cost per recipe
      return costPerBase / ingredientConv.conversionFactor
    }
    if (from === recipeToken && to === baseToken) {
      return costPerBase * ingredientConv.conversionFactor
    }
  }

  return null
}

/**
 * Recompute a canonical ingredient's `costPerRecipeUnit` from the most recent
 * matched invoice line item.
 *
 * - Skips if `costLocked` is true.
 * - Skips if the canonical has no `recipeUnit` set (we don't know what to convert to).
 * - Skips if no matched line item exists yet.
 * - Otherwise updates cost + costSource="invoice" + costUpdatedAt=now.
 *
 * Returns a summary of what happened — useful for logging / UI toasts.
 */
export type RecomputeResult =
  | { status: "updated"; before: number | null; after: number; unit: string }
  | { status: "unchanged"; reason: "locked" | "no-recipe-unit" | "no-match" | "no-derive" | "same-value" }

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
