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
