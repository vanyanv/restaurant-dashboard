/**
 * Visual helpers for ingredient pickers — category color/letter mapping and
 * common unit chips. Kept side-effect free so both the picker sheet and the
 * recipe row can import without circular deps.
 */

export type IngredientPickerValue =
  | {
      kind: "ingredient"
      canonicalIngredientId: string
      label: string
      defaultUnit: string
    }
  | { kind: "recipe"; componentRecipeId: string; label: string }
  | null

type Swatch = { bg: string; ring: string; letter: string; label: string }

/**
 * Resolve a freeform category string to a stable swatch. Common kitchen
 * categories get a hand-tuned color; everything else falls into "Other".
 */
export function categorySwatch(rawCategory: string | null | undefined): Swatch {
  const c = (rawCategory ?? "").toLowerCase().trim()

  if (
    /\b(produce|vegetable|veg|fruit|herb|leaf|green)/.test(c)
  ) {
    return { bg: "#4a7c3a", ring: "#345826", letter: "P", label: "Produce" }
  }
  if (/\b(meat|beef|pork|chicken|poultry|seafood|fish|protein)/.test(c)) {
    return { bg: "#a43c2a", ring: "#7a2a1c", letter: "M", label: "Protein" }
  }
  if (/\b(dairy|cheese|milk|cream|butter|yogurt|egg)/.test(c)) {
    return { bg: "#c9942e", ring: "#9a6e1f", letter: "D", label: "Dairy" }
  }
  if (/\b(spice|seasoning)/.test(c)) {
    return { bg: "#b85427", ring: "#8a3d1c", letter: "S", label: "Spice" }
  }
  if (/\b(oil|fat|vinegar|sauce|condiment|dressing)/.test(c)) {
    return { bg: "#76703c", ring: "#544e29", letter: "O", label: "Oil/Sauce" }
  }
  if (/\b(beverage|drink|juice|soda|tea|coffee|alcohol|wine|beer)/.test(c)) {
    return { bg: "#2f5e7c", ring: "#214358", letter: "B", label: "Beverage" }
  }
  if (/\b(dry|pantry|grain|rice|pasta|flour|sugar|bean|legume|noodle|bread|bakery)/.test(c)) {
    return { bg: "#8a6f3f", ring: "#65522d", letter: "G", label: "Pantry" }
  }
  if (/\b(frozen)/.test(c)) {
    return { bg: "#5b6f8a", ring: "#3f5067", letter: "F", label: "Frozen" }
  }
  if (/\b(prep|sub|recipe)/.test(c)) {
    return { bg: "#7c1515", ring: "#5a0d0d", letter: "R", label: "Sub-recipe" }
  }
  return { bg: "#6b625a", ring: "#4a443e", letter: "•", label: "Other" }
}

/** Stable category bucket keys (used for grouping/filter chips). */
export const CATEGORY_BUCKETS = [
  "Produce",
  "Protein",
  "Dairy",
  "Spice",
  "Oil/Sauce",
  "Pantry",
  "Beverage",
  "Frozen",
  "Other",
] as const

export type CategoryBucket = (typeof CATEGORY_BUCKETS)[number]

export function bucketFor(category: string | null | undefined): CategoryBucket {
  return categorySwatch(category).label as CategoryBucket
}

/**
 * Heuristic: does this canonical ingredient look like a cleaning chemical,
 * delivery fee, equipment line, or other clearly non-recipe item that crept
 * in from invoices?
 *
 * Packaging (foil, parchment, to-go boxes, portion cups, napkins) and
 * disposables (gloves, hairnets) are deliberately NOT filtered — those are
 * real per-order costs that can legitimately appear on a recipe.
 *
 * Conservative on purpose — false negatives (one non-food slipping through)
 * are fine; false positives (hiding real food/packaging) are not. Picker has
 * a "Show all" toggle for the cases this misses.
 */
export function isLikelyNonFood(
  name: string,
  category: string | null | undefined
): boolean {
  const text = `${name} ${category ?? ""}`.toLowerCase()

  // Strong category signals — only the clearly-non-recipe ones. "Disposable"
  // and "packaging" are intentionally absent (we treat those as recipe-able).
  if (category) {
    const c = category.toLowerCase()
    if (
      /\b(cleaning|sanit|chemical|janitor|non[-\s]?food|fee|freight|surcharge|fuel|equipment|repair|maintenance|service ?charge)\b/.test(
        c
      )
    ) {
      return true
    }
  }

  // Strong name signals — items that are unambiguously not food/packaging.
  const nonFoodPatterns: RegExp[] = [
    // Cleaning chemicals
    /\bbleach\b/,
    /\bdegreas/,
    /\bsanitiz/,
    /\bdetergent\b/,
    /\bdish ?(soap|liquid|wash|machine)/,
    /\bcleaner\b/,
    /\bcleaning\b/,
    /\bdeodoriz/,
    /\bair ?freshen/,
    /\b(scrub(ber)?|scour(ing)?|sponge|brillo|steel ?wool)\b/,
    // Janitorial — trash bags / restroom supplies (NOT food packaging)
    /\b(trash|garbage|waste) ?(bag|liner|can)/,
    /\bcan ?liner/,
    /\b(toilet|bath|restroom|hand) ?(paper|tissue|towel)/,
    /\b(toilet|urinal) ?(seat|cleaner|deodor)/,
    // Fees & adjustments
    /\b(fuel|gas) ?(surcharge|charge|fee)/,
    /\bdelivery ?(fee|charge|surcharge)/,
    /\bfreight\b/,
    /\bsurcharge\b/,
    /\bservice ?(fee|charge)\b/,
    /\benvironmental ?(fee|charge)/,
    /\b(rebate|credit ?memo|adjustment|return ?credit)\b/,
    // Equipment & maintenance
    /\bequipment\b/,
    /\bmaintenance\b/,
    /\brepair\b/,
    /\bbattery\b/,
    /\b(light )?bulb\b/,
    /\bfilter\b.*\b(hood|grease|water|fryer|hvac)/,
    /\b(co2|propane) ?(tank|refill|cylinder)?/,
  ]

  return nonFoodPatterns.some((re) => re.test(text))
}

/**
 * Pretty-print a raw invoice-derived ingredient name for display in pickers
 * and recipe rows. Strips pack/size noise ("5 lb", "(case)", "ct/12") and
 * applies title case while preserving small connective words.
 *
 * Pure display transform — the underlying canonical name is unchanged.
 */
export function prettifyIngredientName(raw: string): string {
  if (!raw) return raw
  let s = raw.trim()

  // Drop trailing parens (sizes, vendor SKUs, etc.) — repeat for nested cases.
  for (let i = 0; i < 3; i++) {
    const next = s.replace(/\s*\([^)]*\)\s*$/g, "").trim()
    if (next === s) break
    s = next
  }

  // Strip trailing pack/size descriptors. Run repeatedly because invoices
  // often stack ("shredded mozzarella 5 lb bag case").
  const noiseTrailing =
    /\s+(?:\d+(?:\.\d+)?\s*(?:#|ct|pk|pkt|pack|case|cs|bg|bag|bottle|btl|can|box|jar|qt|pt|gal|lb|lbs|oz|fl ?oz|kg|g|ml|l|each|ea|dz|doz|dozen|count|cnt|ctn|carton|tray|bunch|head|loaf)\b\.?)+\s*$/i
  for (let i = 0; i < 4; i++) {
    const next = s.replace(noiseTrailing, "").trim()
    if (next === s) break
    s = next
  }

  // Common embedded noise: "ct/12", "pk of 6", "x 24", standalone "case", trailing slashes.
  s = s
    .replace(/\b(ct|pk|pack|case|cs|cnt|count)[\s\/]*\d+\b/gi, "")
    .replace(/\bx\s*\d+\b/gi, "")
    .replace(/[\/\-,]+\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim()

  // Title case, but keep small words lowercase unless first.
  const small = new Set([
    "and",
    "or",
    "of",
    "the",
    "for",
    "to",
    "in",
    "on",
    "with",
    "a",
    "an",
  ])
  s = s
    .split(" ")
    .map((word, i) => {
      if (!word) return word
      // Preserve all-caps acronyms (>=2 letters and originally uppercase).
      if (/^[A-Z]{2,}$/.test(word)) return word
      const lower = word.toLowerCase()
      if (i > 0 && small.has(lower)) return lower
      // Don't break hyphenated words apart.
      return lower
        .split("-")
        .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
        .join("-")
    })
    .join(" ")

  return s || raw
}

/** Most-common kitchen units, ordered by likelihood-of-use. */
export const COMMON_UNITS = [
  "oz",
  "lb",
  "g",
  "kg",
  "ea",
  "cup",
  "tbsp",
  "tsp",
  "ml",
  "l",
  "qt",
  "gal",
  "pt",
  "fl oz",
  "serving",
  "unit",
] as const
