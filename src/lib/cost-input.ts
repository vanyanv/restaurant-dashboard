/**
 * The check on a cost an owner types: an ingredient's cost per recipe unit,
 * or a recipe's food-cost override.
 *
 * A negative or NaN/Infinity cost used to save, and from there it carried a
 * wrong (or non-numeric) figure into every recipe using it and on into COGS.
 * Zero is allowed: some things are free. Clearing a cost is `null`, never 0,
 * so a missing cost still reads as missing.
 *
 * The ceiling: saffron, the dearest thing a kitchen buys by weight, runs a few
 * thousand dollars a pound, and no plate these stores sell costs that much to
 * make. Over $10,000 for one unit or one serving is a slipped decimal or a
 * pasted case price, not a cost.
 */
export const MAX_TYPED_COST = 10_000

/** Null when the cost is fine; otherwise the sentence to show the owner. */
export function typedCostError(cost: unknown): string | null {
  if (typeof cost !== "number" || !Number.isFinite(cost)) return "Enter the cost as a number, like 2.45."
  if (cost < 0) return "A cost can't be negative."
  if (cost > MAX_TYPED_COST) return "That cost is over $10,000. Check the decimal point."
  return null
}
