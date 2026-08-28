const VENDOR_ALIASES: Record<string, string> = {
  "sysco": "Sysco",
  "us foods": "US Foods",
  "individual foodservice": "Individual FoodService",
  // The same vendor's own abbreviation, from a different invoice template.
  // Invoice numbering (I01054-00) and email subject format both match the
  // spelled-out spelling; it is one legal entity under two renderings.
  "ifs individual foodservice": "Individual FoodService",
  "restaurant depot": "Restaurant Depot",
  "performance food group": "Performance Food Group",
  "ben e. keith": "Ben E. Keith",
  // "Vitco Foodservice" and "VITCO FOOD SERVICE" arrive from different invoice
  // templates and plotted as two separate bars on the spend-by-vendor chart,
  // which also made the "unique vendors" count one too high.
  "vitco food service": "Vitco Foodservice",
  "vitco foodservice": "Vitco Foodservice",
  "vitco": "Vitco Foodservice",
  "premier meats": "Premier Meats & Crystal Bay",
  // NOT here on purpose: "Premier Deli Services, Inc." ($3,031, one invoice,
  // subject "Fw: Boar's Head 4/8/26 Invoices") and "Bear State Kitchen"
  // ($3,398, one AR statement). Sharing a word with Premier Meats is not
  // evidence of sharing a legal entity, and folding a distinct supplier into
  // another vendor's total is a worse error than showing it separately.
}

export function normalizeVendorName(raw: string): string {
  const lower = raw.toLowerCase().trim()
  for (const [pattern, canonical] of Object.entries(VENDOR_ALIASES)) {
    if (lower.startsWith(pattern)) return canonical
  }
  return raw.trim()
}

/**
 * Identity key for learned (vendor, sku) mappings.
 *
 * `normalizeVendorName` is a *display* normalizer: unknown vendors fall
 * through with their raw casing intact. That made it unsafe as a database
 * key. "VITCO FOODSERVICE" and "Vitco Foodservice" hashed to two different
 * IngredientSkuMatch rows for the same SKU, so one invoice template taught
 * the matcher that Vitco 15725 was the 1.5oz sauce cup and the other taught
 * it the 4x4LB bulk tub — $15,119 of cup purchases booked against the bulk
 * ingredient, and every 15726 invoice that spelled the vendor in caps fell
 * into the review queue because no caps-spelled row existed for it.
 *
 * Case, punctuation and spacing are all noise in a vendor name. Strip them.
 */
export function vendorMatchKey(raw: string): string {
  return normalizeVendorName(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}
