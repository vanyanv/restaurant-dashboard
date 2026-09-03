import { isNonIngredientRow } from "@/lib/invoice-charges"

/**
 * Whether a purchased ingredient can reach a plate — and therefore whether
 * its being in no recipe understates a plate cost.
 *
 * This exists because the Ingredients page reported one number where there
 * are three. **$36,589 of purchases sits against ingredients that appear in
 * no recipe**, which is true, and it was printed as a single figure with the
 * sentence "some of that is genuinely not food". That sentence is the whole
 * problem: an owner cannot act on it. $19,867 of it is foam containers,
 * gloves and can liners, which are SUPPOSED to be outside plate cost and
 * whose absence from recipes is correct. $1,389 of it is a Sysco fuel
 * surcharge that is not a thing at all. What actually understates plate cost
 * is the food — fry shortening, mayonnaise, lemonade syrup, ketchup — and
 * that is a smaller, harder, nameable number.
 *
 * Splitting it is the difference between "43 items need looking at" and "18
 * of them are food and here they are".
 *
 * Two pages read this: Ingredients states the gap, COGS states the bound it
 * puts on plate cost. They must not compute it twice.
 */

/**
 * Categories whose contents end up in a dish.
 *
 * Matched case-insensitively against `CanonicalIngredient.category`, which is
 * a free-text column. Anything unrecognised — including null — is treated as
 * NOT food, so a new category shows up as supplies and gets noticed, rather
 * than silently inflating the understatement figure.
 */
const FOOD_CATEGORIES = new Set([
  "produce",
  "meat",
  "seafood",
  "dairy",
  "bakery",
  "frozen",
  "dry goods",
  "canned and dry",
  "beverages",
  "condiments",
  "spices",
])

export function isFoodCategory(category: string | null | undefined): boolean {
  if (!category) return false
  return FOOD_CATEGORIES.has(category.trim().toLowerCase())
}

export interface ReachRow {
  id: string
  name: string
  category: string | null
  /** Purchases booked against this ingredient, signed. */
  spend: number
}

export interface ReachBucket {
  n: number
  spend: number
  /** Biggest first — the names a sentence can afford to print. */
  top: ReachRow[]
}

export interface ReachSplit {
  /** Food bought and in no recipe. This is what understates plate cost. */
  food: ReachBucket
  /** Packaging, cleaning, equipment. Correctly outside plate cost. */
  supplies: ReachBucket
  /**
   * Not ingredients at all — delivery surcharges the extractor booked into
   * the catalogue, and credit-memo artifacts. These should not be in the
   * catalogue and are counted apart so they never pad either real figure.
   */
  artifacts: ReachBucket
  /** food + supplies + artifacts, which is the headline the page reports. */
  total: ReachBucket
}

const bucket = (rows: ReachRow[]): ReachBucket => ({
  n: rows.length,
  spend: rows.reduce((t, r) => t + r.spend, 0),
  top: [...rows].sort((a, b) => b.spend - a.spend),
})

/**
 * Split ingredients-in-no-recipe into the three groups above.
 *
 * `artifacts` is decided on the NAME, not the category: the Sysco fuel
 * surcharge sits in category "Other" and the double-extracted Creekstone
 * credit sits in "Meat", so a category rule would file one as supplies and
 * the other as $2,691 of negative food.
 */
export function splitReach(rows: ReachRow[]): ReachSplit {
  const artifacts: ReachRow[] = []
  const food: ReachRow[] = []
  const supplies: ReachRow[] = []

  for (const row of rows) {
    if (isNonIngredientRow(row.name) || isCreditArtifact(row.name)) artifacts.push(row)
    else if (isFoodCategory(row.category)) food.push(row)
    else supplies.push(row)
  }

  return {
    food: bucket(food),
    supplies: bucket(supplies),
    artifacts: bucket(artifacts),
    total: bucket(rows),
  }
}

/**
 * A canonical ingredient the extractor invented out of a credit memo's own
 * wording — "…CREEKSTONE RETURN/CANCELLED ORDER". It carries the negative
 * spend of a return and no recipe will ever contain it, so counting it as
 * food would net $2,691 OFF the understatement and make the gap look smaller
 * than it is.
 *
 * Exported because the Inventory catalogue asks the same question for a
 * different reason: a "Return/Cancelled Order" row is not something anyone
 * counts on a shelf, so it does not belong in a queue of things to define.
 */
export function isCreditArtifact(name: string): boolean {
  return /\b(return|cancelled|canceled|credit\s+memo)\b/i.test(name)
}
