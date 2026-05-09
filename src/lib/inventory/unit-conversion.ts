// Convert a count entered by an operator in *native* units (the way they
// counted on the floor — cases, bags, lb, gallons) into the canonical
// *recipe* unit that every downstream calc operates in. Conversion data
// comes from IngredientSkuMatch.conversionFactor + (fromUnit, toUnit) pairs.
//
// Returns a discriminated union — never throws and never silently returns
// the wrong number. Callers must handle the failure modes (missing conversion,
// invalid qty/unit) explicitly so the count entry UI can surface "we don't
// know how to convert from cases to lb for this ingredient" instead of
// storing a bogus quantity.

export interface ConversionEntry {
  fromUnit: string
  toUnit: string
  factor: number
}

export interface ConversionInputs {
  nativeQty: number
  nativeUnit: string
  recipeUnit: string
  conversions: ConversionEntry[]
}

export type ConversionResult =
  | { ok: true; qtyInRecipeUnit: number }
  | { ok: false; reason: "invalid_qty" | "invalid_unit" | "missing_conversion"; fromUnit?: string; toUnit?: string }

function normalize(unit: string): string {
  return unit.trim().toLowerCase()
}

export function convertNativeToRecipeQty(inputs: ConversionInputs): ConversionResult {
  const { nativeQty, nativeUnit, recipeUnit, conversions } = inputs

  if (!Number.isFinite(nativeQty) || nativeQty < 0) {
    return { ok: false, reason: "invalid_qty" }
  }

  const from = normalize(nativeUnit ?? "")
  const to = normalize(recipeUnit ?? "")
  if (from === "" || to === "") {
    return { ok: false, reason: "invalid_unit" }
  }

  if (from === to) {
    return { ok: true, qtyInRecipeUnit: nativeQty }
  }

  const match = conversions.find(
    (c) => normalize(c.fromUnit) === from && normalize(c.toUnit) === to && c.factor > 0
  )
  if (!match) {
    return { ok: false, reason: "missing_conversion", fromUnit: from, toUnit: to }
  }

  return { ok: true, qtyInRecipeUnit: nativeQty * match.factor }
}
