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

/** Σ delivered quantity in `recipeUnit`; `partial` when a unit wouldn't convert. */
export function sumDeliveries(
  lines: DeliveryLine[],
  recipeUnit: string,
): { deliveriesQty: number; partial: boolean } {
  let deliveriesQty = 0
  let partial = false
  for (const line of lines) {
    const qty = convertQty(line.quantity, line.unit ?? recipeUnit, recipeUnit)
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
