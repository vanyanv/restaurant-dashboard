/**
 * Display rules for the Pantry ledger.
 *
 * `formatUnitPrice` widens precision instead of rounding to zero. Three tiles
 * on the live page render "$0.00" for real sub-cent prices (Soda Orange Fanta,
 * Soda Sprite, Ketchup Packets), which reads to an owner as "free" and makes
 * every other number on the page a little less believable.
 */

/**
 * A quarterly dollar impact at or above this earns the red accent. Chosen so
 * that a +45% move on the fry programme ($7,299/quarter) reads as urgent while
 * a +5.2% move on sanitizer ($26/quarter) stays quiet — on the live page those
 * two carry identical red chips.
 */
export const MATERIAL_IMPACT_USD = 250

export function formatUnitPrice(cost: number | null): string | null {
  if (cost == null) return null
  if (cost >= 1) return "$" + cost.toFixed(2)
  if (cost >= 0.01) return "$" + cost.toFixed(3)
  if (cost >= 0.001) return "$" + cost.toFixed(4)
  if (cost > 0) return "$" + cost.toPrecision(2)
  return "$" + cost.toFixed(2)
}

/** True when a price move is worth enough money to interrupt someone. */
export function isMaterialImpact(impact: number | null): boolean {
  return impact != null && Math.abs(impact) >= MATERIAL_IMPACT_USD
}
