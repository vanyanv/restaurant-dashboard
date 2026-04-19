const VENDOR_ALIASES: Record<string, string> = {
  "sysco": "Sysco",
  "us foods": "US Foods",
  "individual foodservice": "Individual FoodService",
  "restaurant depot": "Restaurant Depot",
  "performance food group": "Performance Food Group",
  "ben e. keith": "Ben E. Keith",
}

export function normalizeVendorName(raw: string): string {
  const lower = raw.toLowerCase().trim()
  for (const [pattern, canonical] of Object.entries(VENDOR_ALIASES)) {
    if (lower.startsWith(pattern)) return canonical
  }
  return raw.trim()
}
