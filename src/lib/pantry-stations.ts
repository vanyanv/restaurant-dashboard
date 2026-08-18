/**
 * Kitchen stations for the Pantry ledger.
 *
 * Resolution order is product name FIRST, stored category second. The stored
 * `CanonicalIngredient.category` is unreliable: "Chris & Eddy's House Sauce" is
 * filed under "Other" and its cup under nothing at all, and those two are 18%
 * of 90-day spend. Bucketing on category alone hides the second-largest cost
 * centre in the business inside an "Other" pile.
 */

export const PANTRY_STATIONS = [
  "Beef & Protein",
  "Sauce & Condiment",
  "Bread & Bakery",
  "Dairy & Ice Cream",
  "Fry & Frozen",
  "Produce",
  "Drinks",
  "Dry Goods",
  "Packaging & Supplies",
] as const

export type PantryStation = (typeof PANTRY_STATIONS)[number]

const PACKAGING_STATION: PantryStation = "Packaging & Supplies"

/** Stored categories that are never food, whatever the product name says. */
const PACKAGING_CATEGORIES = new Set(["Paper/Supplies", "Cleaning", "Equipment"])

/**
 * Ordered rules. First match wins, so order encodes precedence: Dairy sits
 * above Fry & Frozen because "whole FROZEN BUTTER" is dairy, and only the fry
 * programme should land in Fry & Frozen.
 */
const RULES: ReadonlyArray<{
  station: PantryStation
  name: RegExp
  categories: readonly string[]
}> = [
  {
    station: "Beef & Protein",
    name: /ground beef|patty|bacon|chicken|sausage|hot dog/i,
    categories: ["Meat"],
  },
  {
    station: "Sauce & Condiment",
    name: /sauce|ketchup|mustard|mayo|mayonnaise|relish|pickle|sce\b|spread/i,
    categories: [],
  },
  {
    station: "Bread & Bakery",
    name: /bread|roll|bun|loaf/i,
    categories: ["Bakery"],
  },
  {
    station: "Dairy & Ice Cream",
    name: /cheese|butter|ice cream|milk|cream/i,
    categories: ["Dairy"],
  },
  {
    station: "Fry & Frozen",
    name: /potato fry|fry |fries|shortening|frozen/i,
    categories: ["Frozen"],
  },
  {
    station: "Produce",
    name: /lettuce|tomato|onion|pepper|avocado/i,
    categories: ["Produce"],
  },
  {
    station: "Drinks",
    name: /syrup|soda|coke|sprite|fanta|water|lemonade|juice|tea/i,
    categories: ["Beverages"],
  },
]

export function stationFor(name: string, category: string | null): PantryStation {
  if (category != null && PACKAGING_CATEGORIES.has(category)) return PACKAGING_STATION
  for (const rule of RULES) {
    if (rule.name.test(name)) return rule.station
    if (category != null && rule.categories.includes(category)) return rule.station
  }
  return "Dry Goods"
}

export function isPackagingStation(station: PantryStation): boolean {
  return station === PACKAGING_STATION
}
