// Pure helpers for turning an invoice line item into per-unit cost numbers.
// Kept free of Prisma / I/O so tests and edge-eligible code can import it.
//
// Two line shapes coexist in our data and MUST be disambiguated before any
// quantity math, or you will silently triple-count weight on catch-weight
// meat lines.
//
//   1. "Pack-converts-to-base" (Sysco-style, the common case):
//        unit ≠ unitSizeUom — e.g. unit=CS, unitSizeUom=OZ
//        quantity is denominated in `unit` (e.g. 1 case)
//        packSize × unitSize is the conversion factor from `unit` to `unitSizeUom`
//        total base qty = quantity × packSize × unitSize
//
//   2. "Already-in-base" (catch-weight meat, see normalizeCatchWeightMeatLines):
//        unit === unitSizeUom (both LB)
//        quantity is the total weight already in `unitSizeUom`
//        packSize × unitSize is *carton metadata* (cases × avg lb/case),
//        retained for display only; it must NOT be multiplied into the total.
//        total base qty = quantity
//
// Routing both shapes through `getLineItemBaseQty` is the only place this
// distinction is encoded. Every new line-item math site must call it instead
// of recomputing `quantity * packSize * unitSize` inline.

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
 * Resolve an invoice line item to `(totalBaseQty, baseUom)` — the two numbers
 * every per-unit cost calculation needs. Handles both line shapes documented
 * at the top of this file.
 *
 * Returns null when the line lacks enough info to derive a base quantity
 * (zero/non-finite total, or no UOM at all).
 */
export function getLineItemBaseQty(
  line: Pick<LineItemForCost, "quantity" | "unit" | "packSize" | "unitSize" | "unitSizeUom">
): { totalBaseQty: number; baseUom: string } | null {
  const packSize = line.packSize && line.packSize > 0 ? line.packSize : 1
  const rawUnitSize = line.unitSize && line.unitSize > 0 ? line.unitSize : null
  const unitSize = rawUnitSize ?? 1

  const orderCanonical = line.unit ? canonicalizeUnit(line.unit) : null
  const sizeCanonical = line.unitSizeUom ? canonicalizeUnit(line.unitSizeUom) : null
  const orderToken = orderCanonical ?? line.unit?.trim().toLowerCase() ?? null
  const sizeToken = sizeCanonical ?? line.unitSizeUom?.trim().toLowerCase() ?? null

  // Shape 2: already-in-base. `unit` and `unitSizeUom` refer to the same UOM,
  // so packSize × unitSize is metadata (carton count × avg per-case weight on
  // catch-weight meat lines), not a conversion factor. Quantity IS the total.
  if (orderToken && sizeToken && orderToken === sizeToken) {
    const totalBaseQty = line.quantity
    if (!isFinite(totalBaseQty) || totalBaseQty === 0) return null
    return { totalBaseQty, baseUom: line.unitSizeUom ?? line.unit ?? "" }
  }

  // Shape 1: pack-converts-to-base. quantity is in `unit`; multiply through
  // packSize × unitSize to land in `unitSizeUom`. When unitSize is missing,
  // we have no conversion to apply, so the base unit is whatever `unit` is.
  const totalBaseQty = line.quantity * packSize * unitSize
  if (!isFinite(totalBaseQty) || totalBaseQty === 0) return null
  const baseUom = (rawUnitSize ? line.unitSizeUom : null) ?? line.unit ?? line.unitSizeUom ?? ""
  if (!baseUom) return null
  return { totalBaseQty, baseUom }
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
  const resolved = getLineItemBaseQty(line)
  if (!resolved) return null
  const { totalBaseQty, baseUom } = resolved

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
