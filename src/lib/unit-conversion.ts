// Unit conversion for recipe / invoice normalization.
//
// Supports weight, volume, and count within-category. No cross-category conversion
// (e.g. lb → fl oz) — when that's needed, the caller falls back to a per-ingredient
// conversion factor stored on IngredientSkuMatch.
//
// Unit strings are normalized by lowercasing, trimming, stripping punctuation and
// spaces, and mapping synonyms (LB/lbs/pound → lb, CT/count/each/EA → each, etc.).

/** Unit families. Conversions are only defined within a family. */
export type UnitCategory = "mass" | "volume" | "count"

/**
 * All canonical unit tokens this module understands. Anything we can't recognize
 * is passed through untouched — the caller will typically get a null from
 * `convert` and treat the line as `missingCost`.
 */
export type CanonicalUnit =
  | "lb" | "oz" | "g" | "kg"
  | "gal" | "qt" | "pt" | "cup" | "fl oz" | "ml" | "l"
  | "each" | "dz"

type UnitMeta = {
  canonical: CanonicalUnit
  category: UnitCategory
  /** Multiplier to convert 1 {canonical} into the family's base unit. */
  toBase: number
}

/** Base unit per category: grams for mass, millilitres for volume, items for count. */
const UNIT_TABLE: Record<CanonicalUnit, UnitMeta> = {
  // mass — base = gram
  g:     { canonical: "g",     category: "mass",   toBase: 1 },
  kg:    { canonical: "kg",    category: "mass",   toBase: 1000 },
  oz:    { canonical: "oz",    category: "mass",   toBase: 28.349523125 },
  lb:    { canonical: "lb",    category: "mass",   toBase: 453.59237 },

  // volume — base = millilitre
  ml:    { canonical: "ml",    category: "volume", toBase: 1 },
  l:     { canonical: "l",     category: "volume", toBase: 1000 },
  "fl oz": { canonical: "fl oz", category: "volume", toBase: 29.5735295625 },
  cup:   { canonical: "cup",   category: "volume", toBase: 236.5882365 },
  pt:    { canonical: "pt",    category: "volume", toBase: 473.176473 },
  qt:    { canonical: "qt",    category: "volume", toBase: 946.352946 },
  gal:   { canonical: "gal",   category: "volume", toBase: 3785.411784 },

  // count — base = each
  each:  { canonical: "each",  category: "count",  toBase: 1 },
  dz:    { canonical: "dz",    category: "count",  toBase: 12 },
}

/** Synonym map — lowercase trimmed input → canonical unit. */
const SYNONYMS: Record<string, CanonicalUnit> = {
  // mass
  "lb": "lb", "lbs": "lb", "pound": "lb", "pounds": "lb",
  "oz": "oz", "ozs": "oz", "ounce": "oz", "ounces": "oz",
  // R365 weight-vs-fluid disambiguated forms (see also fl oz below).
  "oz-wt": "oz", "oz wt": "oz", "wt oz": "oz", "oz-w": "oz",
  "g": "g", "gr": "g", "gram": "g", "grams": "g",
  "kg": "kg", "kgs": "kg", "kilo": "kg", "kilogram": "kg", "kilograms": "kg",
  // volume
  "ml": "ml", "milliliter": "ml", "milliliters": "ml",
  "l": "l", "ltr": "l", "liter": "l", "liters": "l", "litre": "l", "litres": "l",
  "floz": "fl oz", "fl oz": "fl oz", "fluid ounce": "fl oz", "fluid ounces": "fl oz",
  "oz-fl": "fl oz", "oz fl": "fl oz", "fl-oz": "fl oz",
  "cup": "cup", "cups": "cup", "c": "cup",
  "pt": "pt", "pint": "pt", "pints": "pt",
  "qt": "qt", "quart": "qt", "quarts": "qt",
  "gal": "gal", "gallon": "gal", "gallons": "gal",
  // count
  "each": "each", "ea": "each", "ct": "each", "count": "each",
  "piece": "each", "pieces": "each", "pc": "each", "pcs": "each", "unit": "each",
  "dz": "dz", "doz": "dz", "dozen": "dz", "dozens": "dz",
}

/** Lowercase, trim, collapse whitespace, strip leading "/" etc. */
function clean(raw: string): string {
  return raw.toLowerCase().trim().replace(/\s+/g, " ").replace(/[.]+$/g, "")
}

/**
 * Resolve any incoming unit string to a canonical unit token, or null if
 * we don't recognize it. Safe for display in fallback paths.
 *
 * We explicitly don't do a "naive plural strip" here — short 2-3 char tokens
 * like "CS" (case) or "BS" (bags) would collide with 1-char synonyms and
 * produce nonsense mappings. All real plurals ("pounds", "kgs", …) are in
 * the synonyms table directly.
 */
export function canonicalizeUnit(raw: string | null | undefined): CanonicalUnit | null {
  if (!raw) return null
  const c = clean(raw)
  if (c in SYNONYMS) return SYNONYMS[c]
  return null
}

/**
 * Convert `value` from `fromUnit` to `toUnit` using standard within-category
 * conversions. Returns null when:
 *   - Either unit is unrecognized.
 *   - The units belong to different categories (mass vs volume, etc.).
 */
export function convert(value: number, fromUnit: string, toUnit: string): number | null {
  const from = canonicalizeUnit(fromUnit)
  const to = canonicalizeUnit(toUnit)
  if (!from || !to) return null
  const fromMeta = UNIT_TABLE[from]
  const toMeta = UNIT_TABLE[to]
  if (fromMeta.category !== toMeta.category) return null
  return (value * fromMeta.toBase) / toMeta.toBase
}

/**
 * True when both units are recognized and live in the same category, so a
 * conversion will succeed. Useful for UI to show "unit mismatch" warnings
 * before a cost calc blows up.
 */
export function unitsCompatible(a: string, b: string): boolean {
  const ca = canonicalizeUnit(a)
  const cb = canonicalizeUnit(b)
  if (!ca || !cb) return false
  return UNIT_TABLE[ca].category === UNIT_TABLE[cb].category
}

/**
 * Every canonical unit in the same family as `unit`, in a sensible order for a
 * picker: the unit itself first, then its siblings largest to smallest.
 *
 * This is what makes an unconvertible recipe line unreachable rather than
 * merely discouraged. A line's unit box is built from the unit its ingredient
 * is PRICED in, so the owner cannot pick `cup` against a price per `lb` and
 * get a line that silently costs $0.00 forever — see `computeIngredientLineCost`,
 * which returns `qtyInCostUnit: null` for exactly that pair.
 *
 * Returns `[]` when the unit is not one we recognise, which is the honest
 * answer: we have no idea what converts into "sleeve", so we offer nothing
 * rather than offering the wrong thing.
 */
export function unitsCompatibleWith(unit: string | null | undefined): CanonicalUnit[] {
  const canonical = canonicalizeUnit(unit)
  if (!canonical) return []
  const category = UNIT_TABLE[canonical].category
  return FAMILY_ORDER[category]
}

/**
 * Picker order per family — biggest first, because a recipe reaches for the
 * big unit ("1 gal") more often than the small one ("128 fl oz"), and a list
 * that opens on `g` when the price is per `lb` reads as the wrong list.
 */
const FAMILY_ORDER: Record<UnitCategory, CanonicalUnit[]> = {
  mass: ["lb", "oz", "kg", "g"],
  volume: ["gal", "qt", "pt", "cup", "fl oz", "l", "ml"],
  count: ["each", "dz"],
}

/**
 * The units a recipe line may use to draw on a BATCH recipe.
 *
 * A batch recipe with a `yieldUnit` is measured: "one batch makes 128 fl oz",
 * so a line takes fluid ounces, cups, quarts or gallons out of it. A batch
 * recipe with no `yieldUnit` yields PORTIONS, and the only quantity that means
 * anything is how many portions — so the list is the portion words, and
 * `PORTION_UNITS` is what `resolveYieldQuantity` accepts for them.
 */
export const PORTION_UNITS = ["serving", "servings", "portion", "portions", "plate", "plates", "each", "ea", "unit", "units", ""] as const

/** The label a portion-yield recipe's lines carry. */
export const PORTION_UNIT_LABEL = "serving"

/**
 * How much of a batch a recipe line draws, expressed in the batch's own yield
 * unit — the one number that turns "2 oz of house sauce" into a share of a
 * batch instead of two whole batches.
 *
 * `yieldUnit` null means the batch yields portions; the line is then counted
 * in portions and any of `PORTION_UNITS` is accepted (an empty or unrecognised
 * portion word is NOT — see below). Otherwise the line's unit must convert
 * into the yield unit.
 *
 * Returns null when the two cannot be reconciled. A null is a REFUSAL, not a
 * zero: the caller marks the line missing rather than costing it, because the
 * two wrong answers available here — charge the whole batch, or charge nothing
 * — are both worse than saying so.
 */
export function resolveYieldQuantity(args: {
  quantity: number
  unit: string | null | undefined
  yieldUnit: string | null | undefined
}): number | null {
  const { quantity, unit, yieldUnit } = args
  if (!isFinite(quantity)) return null

  if (!yieldUnit) {
    const token = (unit ?? "").trim().toLowerCase()
    return (PORTION_UNITS as readonly string[]).includes(token) ? quantity : null
  }

  const from = canonicalizeUnit(unit)
  const to = canonicalizeUnit(yieldUnit)
  if (!from || !to) {
    // Neither side is a unit we can convert. Only an exact string match is
    // safe — "batch" against "batch" is fine, "batch" against "tray" is not.
    const same = (unit ?? "").trim().toLowerCase() === yieldUnit.trim().toLowerCase()
    return same ? quantity : null
  }
  return convert(quantity, unit as string, yieldUnit)
}
