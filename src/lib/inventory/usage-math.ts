import { canonicalizeUnit, convert } from "@/lib/unit-conversion"

/**
 * Pure arithmetic shared by the per-ingredient inventory readers
 * (`computeRunningOnHand`, `computeDailyDepletionRate`) and the batched
 * dashboard reader in `store-inventory-context.ts`.
 *
 * The two paths differ only in how they *fetch* — one query set per ingredient
 * versus a handful of store-wide queries reused across all of them. Keeping the
 * maths in one place is what makes them provably equivalent; before this the
 * dashboard fired roughly ten round-trips per ingredient (~760 for a 76-item
 * pantry) and re-ran the identical store-wide sales and mapping queries once
 * for every ingredient.
 */

export function convertQty(
  qty: number,
  fromUnit: string,
  toUnit: string,
): number | null {
  const a = canonicalizeUnit(fromUnit)
  const b = canonicalizeUnit(toUnit)
  if (a && b && a === b) return qty
  if (a && b) return convert(qty, fromUnit, toUnit)
  return fromUnit.trim().toLowerCase() === toUnit.trim().toLowerCase() ? qty : null
}

export interface DeliveryLine {
  quantity: number
  unit: string | null
}

/**
 * How the ingredient is packed, from `CanonicalIngredient`. Every field may be
 * null; the pack is only consulted when the pieces it needs are present.
 */
export interface IngredientPack {
  caseUnit?: string | null
  recipeUnitsPerCase?: number | null
  innerPackUnit?: string | null
  innerPacksPerCase?: number | null
}

/**
 * `!= null` on purpose, not `!== null`: a Prisma `select` that omits the pack
 * columns hands these back as `undefined`, and a strict null check let
 * `undefined.trim()` through. Every caller inside this repo now selects them,
 * but a test double or a narrower select must not be able to throw here.
 */
const same = (a: string | null | undefined, b: string | null | undefined) =>
  a != null && b != null && a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * Convert a delivered quantity into the recipe unit using the ingredient's own
 * pack definition, before falling back to dimensional conversion.
 *
 * ## Why this exists
 *
 * Invoices are written in cases. `InvoiceLineItem.unit` is `CS` on all but a
 * handful of this account's 1,667 lines, and `recipeUnit` is `each`, `oz`,
 * `gal`, `ml` or `lb`. There is no dimensional conversion from a case to an
 * each — a case is however many the supplier decided to put in it — so
 * `convertQty` correctly returns null, `sumDeliveries` marked the line partial
 * and DROPPED it.
 *
 * Depletion has no such problem: recipes are already written in recipe units.
 * So the running on-hand integral was consumption with no supply, and it could
 * only ever go down. Measured on 2026-08-28, before this: of 76 ingredients,
 * 72 were `partial`, 73 had `deliveriesQty` of exactly zero, 31 held a
 * NEGATIVE on-hand, and Σ(cost × onHand) came to **−$372,975**. Coke Mexican
 * Glass read −1,694,000 ml — 4,844 bottles in debt.
 *
 * `CanonicalIngredient` already carries the missing factor:
 * `recipeUnitsPerCase` is set on 61 of the 76, and `caseUnit` is literally
 * `"CS"` on 59 of them. It was never passed in — `sumDeliveries` took only
 * `(lines, recipeUnit)`.
 *
 * A line still marks `partial` when nothing converts it, which is the honest
 * outcome and what callers surface. This only removes the cases where the
 * answer was sitting on the same row.
 */
export function convertDelivered(
  qty: number,
  fromUnit: string,
  recipeUnit: string,
  pack?: IngredientPack | null,
): number | null {
  if (pack) {
    const { caseUnit, recipeUnitsPerCase, innerPackUnit, innerPacksPerCase } = pack
    if (same(fromUnit, caseUnit) && recipeUnitsPerCase != null && recipeUnitsPerCase > 0) {
      return qty * recipeUnitsPerCase
    }
    if (
      same(fromUnit, innerPackUnit) &&
      recipeUnitsPerCase != null &&
      innerPacksPerCase != null &&
      innerPacksPerCase > 0
    ) {
      return qty * (recipeUnitsPerCase / innerPacksPerCase)
    }
  }
  return convertQty(qty, fromUnit, recipeUnit)
}

/**
 * Σ delivered quantity in `recipeUnit`; `partial` when a unit wouldn't convert.
 *
 * `pack` is optional so the signature stays compatible, but every production
 * caller passes it — see `convertDelivered` for what omitting it costs.
 */
export function sumDeliveries(
  lines: DeliveryLine[],
  recipeUnit: string,
  pack?: IngredientPack | null,
): { deliveriesQty: number; partial: boolean } {
  let deliveriesQty = 0
  let partial = false
  for (const line of lines) {
    const qty = convertDelivered(line.quantity, line.unit ?? recipeUnit, recipeUnit, pack)
    if (qty == null) {
      partial = true
      continue
    }
    deliveriesQty += qty
  }
  return { deliveriesQty, partial }
}

export interface SoldItem {
  itemName: string
  fpQuantitySold: number | null
  tpQuantitySold: number | null
}

/**
 * Σ theoretical depletion for one ingredient across sold menu items.
 *
 * `perServing` is looked up per recipe and memoised by the caller, matching the
 * original inline loops exactly (including that an unmapped item contributes
 * nothing rather than being treated as zero-cost).
 */
export function sumDepletion(
  sales: SoldItem[],
  recipeByItemName: Map<string, string>,
  perServing: (recipeId: string) => number,
): number {
  const memo = new Map<string, number>()
  let depletionQty = 0
  for (const s of sales) {
    const recipeId = recipeByItemName.get(s.itemName)
    if (!recipeId) continue
    let per = memo.get(recipeId)
    if (per === undefined) {
      per = perServing(recipeId)
      memo.set(recipeId, per)
    }
    const sold = (s.fpQuantitySold ?? 0) + (s.tpQuantitySold ?? 0)
    depletionQty += per * sold
  }
  return depletionQty
}

export const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Depletion window: max(asOf - lookback, lastCountAt), clamped to ≥ 1 day.
 * A count inside the lookback anchors the window — days before it would be
 * measured against an estimate rather than a known quantity.
 */
export function depletionWindow(
  asOf: Date,
  lastCountAt: Date | null,
  lookbackDays: number,
): { windowStart: Date; windowDays: number } {
  const lookbackStart = new Date(asOf.getTime() - lookbackDays * MS_PER_DAY)
  const windowStart =
    lastCountAt && lastCountAt.getTime() > lookbackStart.getTime()
      ? lastCountAt
      : lookbackStart
  const rawDays = (asOf.getTime() - windowStart.getTime()) / MS_PER_DAY
  return { windowStart, windowDays: Math.max(1, Math.round(rawDays)) }
}
