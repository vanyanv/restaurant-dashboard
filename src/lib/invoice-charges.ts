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

// ─── Tie-out ───
//
// Whether an invoice's extracted lines add up to the document, asked ONCE for
// the sync's REVIEW rule, the Approve gate, Needs you and the vendor pages.
// Until 2026-10-28 there were five copies — the sync allowed 2% (or $1) and
// the four Counter adapters allowed 2¢ — so an invoice could import as
// MATCHED, show as "does not add up", and refuse to be approved.
//
// The exact-name `isChargeRow` set above cannot keep up with vendors: IFS's
// new layout prints "Freight/Misc.", Sysco prints its fuel surcharge under
// six spellings, and which side of the subtotal a fee sits on varies by
// vendor and even by invoice (the table at the top of this file). So instead
// of deciding in advance, the tie-out tries each reading of the fee rows —
// every subset of them counted inside the subtotal — and accepts the
// invoice when any reading lands within a dollar. Fee rows are few (never
// more than three on this account), so that is at most a handful of sums.
// Only fee-shaped rows with no SKU move: a product line never does, so an
// unnamed extra line still shows as a gap (see the "UNNAMED extra line" test).
// Deliberately NOT tried: all lines plus tax against the total. That was the
// three-reference escape hatch removed on 2026-08-28.
//
// Measured on this account's 277 invoices (2026-10-28): the old 2¢
// exact-name check failed 9; this fails 4, and all four are real — a credit
// read twice, a header with no lines, an invoice $124.68 over, and a Sysco
// subtotal read $83.10 short.

/** Largest gap, in dollars, that still counts as adding up. */
export const TIE_OUT_TOLERANCE = 1

const FEE_LIKE_RE =
  /\b(fuel|freight|pallet|delivery)\b|surcharge|^misc(ellaneous|\.|\b)|sales\s+tax|^total\s+sales\s+tax$/i

/** Most fee rows the tie-out will try readings over (2^n sums). */
const MAX_FEE_ROWS = 6

/**
 * A delivery fee, tax or surcharge row: no SKU and a fee-shaped name. These
 * are the rows whose side of the subtotal varies, so the tie-out tries both.
 */
export function isFeeRow(line: { productName: string | null | undefined; sku?: string | null }): boolean {
  const name = line.productName?.trim() ?? ""
  // The four exact names stay fees whatever the SKU, as they always were.
  if (isChargeRow(name)) return true
  if (line.sku != null && line.sku.trim() !== "") return false
  return FEE_LIKE_RE.test(name)
}

export interface TieOut {
  /** True when some reading of the fee rows lands within TIE_OUT_TOLERANCE. */
  reconciles: boolean
  /** Lines counted as goods under the chosen reading. */
  goods: number
  /** What `goods` was compared against: the subtotal, or total less tax. */
  reference: number
  referenceKind: "subtotal" | "total less tax"
  /** goods − reference under the closest reading (signed). */
  gap: number
  /** Indexes into the input of the rows treated as outside the goods. */
  outside: ReadonlySet<number>
}

/**
 * Do these lines add up to what the document prints?
 *
 * Returns the closest reading even when none ties out, so a page can show
 * how far off the invoice is on its most charitable reading.
 */
export function tieOut(
  lines: ReadonlyArray<{ productName: string; sku?: string | null; extendedPrice: unknown }>,
  head: { subtotal: number | null; taxAmount: number | null; totalAmount: number }
): TieOut {
  const tax = head.taxAmount ?? 0
  const printed = tieOutAgainst(
    lines,
    head.subtotal ?? head.totalAmount - tax,
    head.subtotal != null ? "subtotal" : "total less tax"
  )
  if (printed.reconciles || head.subtotal == null) return printed

  // Sysco prints a subtotal per product group, and the model sometimes takes
  // one group's for the invoice's (945683569: $612.50 read for $695.60). When
  // every goods line is a real catalogue item (a SKU on each) and they tie
  // exactly to the printed total less tax, the subtotal is the misread. An
  // extra line with no SKU gets no such pass — that is the shape of a line
  // the model invented, which the total-less-tax reading used to let through.
  const goodsHaveSkus = lines.every(
    (line) => readPrice(line.extendedPrice) === null || isFeeRow(line) || !!line.sku?.trim()
  )
  if (!goodsHaveSkus) return printed
  const total = tieOutAgainst(lines, head.totalAmount - tax, "total less tax")
  return Math.round(Math.abs(total.gap) * 100) <= 1 ? total : printed
}

function tieOutAgainst(
  lines: ReadonlyArray<{ productName: string; sku?: string | null; extendedPrice: unknown }>,
  reference: number,
  referenceKind: TieOut["referenceKind"]
): TieOut {
  let base = 0
  const fees: Array<{ index: number; price: number }> = []
  lines.forEach((line, index) => {
    const price = readPrice(line.extendedPrice)
    if (price === null) return
    if (isFeeRow(line) && fees.length < MAX_FEE_ROWS) fees.push({ index, price })
    else base += price
  })

  let best: TieOut | null = null
  const consider = (candidate: TieOut) => {
    if (!best || Math.abs(candidate.gap) < Math.abs(best.gap)) best = candidate
  }

  // Every subset of fee rows counted inside the reference. Mask bit i set
  // means fee i is INSIDE (counted as goods).
  for (let mask = 0; mask < 1 << fees.length; mask++) {
    let goods = base
    const outside = new Set<number>()
    fees.forEach((fee, i) => {
      if (mask & (1 << i)) goods += fee.price
      else outside.add(fee.index)
    })
    consider({ reconciles: false, goods, reference, referenceKind, gap: goods - reference, outside })
  }

  const chosen = best as unknown as TieOut
  // In whole cents: 100.99 − 100 is 0.98999…, which must not read as over.
  return { ...chosen, reconciles: Math.round(Math.abs(chosen.gap) * 100) <= TIE_OUT_TOLERANCE * 100 }
}
