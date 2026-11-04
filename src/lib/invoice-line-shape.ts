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

/**
 * How far a freshly-derived invoice cost may sit from the ingredient's
 * established price, either way, before it is treated as a misread rather than
 * a price move. Real food prices rarely move more than ~2–3x; the pack-shape
 * misreads that have poisoned COGS land at 10x–200x. Until 2026-11-03 this was
 * 8x; the owner's line is that a move over 5x must never silently become a
 * recipe price, and it now holds at 5x.
 */
export const COST_SPIKE_THRESHOLD = 5

/** How many recent invoice lines the price-move readouts weigh. */
export const COST_CANDIDATE_WINDOW = 8

/**
 * How many verified invoice lines the BOOKED cost is judged over. Wider than
 * `COST_CANDIDATE_WINDOW` on purpose: the 9x6 foam container (IFS, 2026-10)
 * had seven misread lines in a row after the vendor changed its SKU, so the
 * eight newest lines were mostly wrong and the guard measured each misread
 * against other misreads. Forty lines is months of a weekly delivery — the
 * price the ingredient actually held, not last week's reading of it.
 */
export const COST_HISTORY_WINDOW = 40

/** Readings within this factor of each other count as the same price. */
const SAME_PRICE_FACTOR = 1.5

function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const sorted = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

/**
 * The ingredient's established price over a window of readings: the price the
 * most readings agree on (within `SAME_PRICE_FACTOR`), the older one on a tie
 * — a price that has held longer is the one that is established. Returns the
 * median of that cluster. `costs` newest first, all positive and finite.
 */
export function establishedCost(costs: number[]): number | null {
  if (costs.length === 0) return null
  let bestIdx = -1
  let bestSupport = -1
  for (let i = 0; i < costs.length; i++) {
    const c = costs[i]
    const support = costs.filter((o) => o <= c * SAME_PRICE_FACTOR && o >= c / SAME_PRICE_FACTOR).length
    // `>=` walks toward the older end on a tie.
    if (support >= bestSupport) {
      bestSupport = support
      bestIdx = i
    }
  }
  const anchor = costs[bestIdx]
  return median(costs.filter((o) => o <= anchor * SAME_PRICE_FACTOR && o >= anchor / SAME_PRICE_FACTOR))
}

/**
 * Pick which of several invoice-derived costs to trust, newest-first.
 *
 * Each reading is judged against a TRUSTED price, never against whatever
 * happens to be older than it. Until 2026-11-03 each line was compared with
 * the median of the lines after it, which fails exactly when it matters: the
 * IFS 9x6 foam container was read at 1 EA, 1 COMP and "30.72" a case for
 * weeks, every misread compared against other misreads, and a $0.15 container
 * went into recipes at $2.51 and $15.36.
 *
 * Now:
 *   1. The established price is the one most of the window agrees on
 *      (`establishedCost`), the older on a tie.
 *   2. The readings are walked oldest to newest. Each is accepted only when
 *      it is within `threshold`× of the trusted price — the established price
 *      until three readings are trusted, then the median of the trusted ones,
 *      so a real price that moves gradually is followed.
 *   3. The newest accepted reading is the price. A rejected reading never
 *      enters the trusted history, so a run of misreads cannot vouch for
 *      itself however long it gets.
 *
 * Non-finite / non-positive costs are skipped and never form a baseline.
 *
 * @returns the chosen index and whether a newer reading was rejected.
 */
export function selectNonSpikeCostIndex(
  costsNewestFirst: number[],
  threshold: number = COST_SPIKE_THRESHOLD
): { index: number; rejectedSpike: boolean } {
  const valid = costsNewestFirst
    .map((c, i) => ({ c, i }))
    .filter((r) => isFinite(r.c) && r.c > 0)
  if (valid.length === 0) return { index: 0, rejectedSpike: false }

  const seed = establishedCost(valid.map((r) => r.c))!
  const trusted: number[] = []
  const accepted = new Set<number>()
  for (let k = valid.length - 1; k >= 0; k--) {
    const { c, i } = valid[k]
    const baseline = trusted.length >= 3 ? median(trusted) : seed
    if (c <= baseline * threshold && c >= baseline / threshold) {
      trusted.push(c)
      accepted.add(i)
    }
  }

  const chosen = valid.find((r) => accepted.has(r.i))
  if (!chosen) {
    // Unreachable in practice — the established price is itself a reading —
    // but never hand back a reading the guard did not accept as if it had.
    const closest = valid.reduce((a, b) =>
      Math.abs(Math.log(b.c / seed)) < Math.abs(Math.log(a.c / seed)) ? b : a,
    )
    return { index: closest.i, rejectedSpike: closest.i !== valid[0].i }
  }
  const rejectedSpike = valid.some((r) => r.i < chosen.i && !accepted.has(r.i))
  return { index: chosen.i, rejectedSpike }
}

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
  // packSize × unitSize to land in `unitSizeUom`.
  //
  // That conversion needs both halves of the factor AND a UOM to land in.
  // `unitSize` is the half that carries a magnitude (how much `unitSizeUom` is
  // in one inner pack); `packSize` only counts inner packs. Applied on its own
  // it converts nothing — it restates 1 CS of a 6-pack as "6 CS", which then
  // divides the line's extended price by six and understates the cost of
  // everything that case feeds by the pack size. `unitSizeUom` is the
  // destination; without it there is nothing to convert into either.
  //
  // So unless both are present, the quantity stands exactly as the invoice
  // wrote it, denominated in `unit`. And with no `unit` either, we do not know
  // what the quantity counts, which is the one case that has no answer.
  if (rawUnitSize === null || !line.unitSizeUom) {
    if (!line.unit) return null
    if (!isFinite(line.quantity) || line.quantity === 0) return null
    return { totalBaseQty: line.quantity, baseUom: line.unit }
  }

  const totalBaseQty = line.quantity * packSize * unitSize
  if (!isFinite(totalBaseQty) || totalBaseQty === 0) return null
  return { totalBaseQty, baseUom: line.unitSizeUom }
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
