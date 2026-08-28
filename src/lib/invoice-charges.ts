// The one definition of an invoice line that is NOT goods.
//
// Vendors disagree about where delivery surcharges live. Individual
// FoodService prints its pallet and fuel charges BELOW the subtotal rule, so
// the extractor reads them as products and a naive
// `SUM(extendedPrice) = subtotal` check fails on invoices nobody got wrong.
// Sysco prints its fuel surcharge ABOVE the rule, inside the subtotal, so the
// same names must NOT be excluded there.
//
// Measured on this account's 226 invoices (2026-08-28):
//
//   exclusion set                sum vs subtotal, within $0.02
//   ───────────────────────────  ─────────────────────────────
//   nothing excluded                        173 / 226
//   the four names below                    219 / 226   ← this
//   the four + "CHGS FOR FUEL SURCHARGE"    163 / 226
//
// The third row is the whole argument for matching on the exact name. Sysco's
// fuel surcharge is inside its subtotal; excluding it un-reconciles 56
// invoices that were fine. A regex on /fuel|pallet|delivery/ does the same
// thing and also eats product names containing those words.
//
// Adding a name here is a claim that some vendor prints it OUTSIDE the
// subtotal. Re-run `strict-vs-subtotal` before you believe it.

/**
 * Exact `productName` values that sit outside their invoice's printed
 * subtotal. Compared case-sensitively and whole — see the module note.
 */
export const CHARGE_ROW_NAMES: readonly string[] = [
  "Fuel Charge",
  "Pallet Charge",
  "Miscellaneous Charge",
  "Total SALES TAX",
]

const CHARGE_ROWS = new Set(CHARGE_ROW_NAMES)

/** True when this line is a delivery surcharge printed below the subtotal. */
export function isChargeRow(productName: string | null | undefined): boolean {
  return productName != null && CHARGE_ROWS.has(productName)
}

/**
 * A line's price, or null when the extractor did not read one.
 *
 * `Number(null)` is 0 and `Number("")` is 0, so the obvious
 * `Number.isFinite(Number(x))` guard accepts an unread price as $0.00 — which
 * is how a dropped line becomes a silent shortfall in the reconciliation
 * check instead of a flagged one. Null, undefined and blank are rejected
 * before the coercion, not after it.
 */
function readPrice(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === "string" && value.trim() === "") return null
  const price = Number(value)
  return Number.isFinite(price) ? price : null
}

/**
 * Sum of the line prices that the printed subtotal is supposed to cover.
 *
 * Lines with no readable price are dropped rather than counted as zero — see
 * `readPrice`.
 */
export function goodsSum(
  lines: ReadonlyArray<{ productName: string; extendedPrice: unknown }>
): number {
  let total = 0
  for (const line of lines) {
    if (isChargeRow(line.productName)) continue
    const price = readPrice(line.extendedPrice)
    if (price === null) continue
    total += price
  }
  return total
}

/** Lines that carry a readable price and are goods. */
export function goodsLines<T extends { productName: string; extendedPrice: unknown }>(
  lines: ReadonlyArray<T>
): T[] {
  return lines.filter(
    (line) => !isChargeRow(line.productName) && readPrice(line.extendedPrice) !== null
  )
}

// ─── Catalogue hygiene ───
//
// A DIFFERENT question, deliberately kept apart. `isChargeRow` asks "is this
// inside the subtotal", which is about arithmetic and is vendor-specific.
// `isNonIngredientRow` asks "is this a thing you can put on a plate", which is
// about the ingredient catalogue and is not.
//
// Sysco's fuel surcharge answers YES to the first and NO to the second. It is
// inside the subtotal — so reconciliation must count it — and it is also
// matched to a canonical ingredient named "fuel surcharge" carrying $1,389 of
// "purchases", which is how a delivery fee ended up in the ingredient
// catalogue and in the count of things that reach no recipe.

const NON_INGREDIENT_RE =
  /^(chgs\s+for\s+)?(fuel|pallet|misc(ellaneous)?|delivery|freight)\b.*\b(charge|surcharge)s?\b|^(fuel|pallet)\s+charge$|^total\s+sales\s+tax$|^miscellaneous\s+charges?\b/i

/**
 * True when a line — or a canonical ingredient's name — describes a fee
 * rather than something bought.
 *
 * Unlike `isChargeRow` this IS a regex, because it is allowed to be: getting
 * it wrong drops a row from a catalogue count, not from an arithmetic check.
 */
export function isNonIngredientRow(name: string | null | undefined): boolean {
  if (!name) return false
  return NON_INGREDIENT_RE.test(name.trim())
}
