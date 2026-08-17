const VENDOR_ALIASES: Record<string, string> = {
  "sysco": "Sysco",
  "us foods": "US Foods",
  "individual foodservice": "Individual FoodService",
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
}

export function normalizeVendorName(raw: string): string {
  const lower = raw.toLowerCase().trim()
  for (const [pattern, canonical] of Object.entries(VENDOR_ALIASES)) {
    if (lower.startsWith(pattern)) return canonical
  }
  return raw.trim()
}
