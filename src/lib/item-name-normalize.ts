// Shared name folding for POS-item ↔ recipe resolution. POS spellings drift
// from recipe names in punctuation, case, and stray whitespace ("Straight-Cut
// Fries" vs "Straight Cut Fries "); both sides fold through normalizeItemName
// before comparison so those never need an LLM.

/** Lowercase, collapse every non-alphanumeric run to a single space, trim. */
export function normalizeItemName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/**
 * Remove a trailing "[Category]" tag. The proposal prompt renders its
 * vocabulary as "Name [Category]" and the model copies that suffix into the
 * names it returns; real menu names use parens, never a trailing bracket.
 */
export function stripCategoryBracket(name: string): string {
  return name.replace(/\s*\[[^\]]*\]\s*$/, "")
}
