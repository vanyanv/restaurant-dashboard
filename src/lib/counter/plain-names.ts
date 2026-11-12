/**
 * The name an owner says out loud for an ingredient. Ingredients are named
 * after the invoice line ("lamb potato fry ss 1/4 stealth"), which is how a
 * vendor finds it and nobody counts by. Every Count & waste screen shows
 * `plainName` large and keeps the invoice text underneath, so the two can
 * always be matched. First matching rule wins; anything unmatched gets its
 * invoice text with a capital letter, never a guess.
 */

const RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/potato fry|french fr/i, "Fries"],
  [/potato roll|martins? bread/i, "Potato rolls"],
  [/ground beef/i, "Ground beef"],
  [/house sauce cup/i, "House sauce cups 1.5 oz"],
  [/house sauce/i, "House sauce"],
  [/soft serve|ice cream mix/i, "Soft serve mix"],
  [/lettuce/i, "Lettuce"],
  [/onion/i, "Onions"],
  [/tomato/i, "Tomatoes"],
  [/butter/i, "Butter"],
  [/shortening fry|fry oil|frying oil/i, "Fry oil"],
  [/ketchup packet/i, "Ketchup packets"],
  [/syrup coca|syrup coke/i, "Coke syrup"],
  [/syrup sprite/i, "Sprite syrup"],
  [/syrup lemonade/i, "Lemonade syrup"],
  [/coke mexican|coca.?cola mexican/i, "Mexican Coke"],
  [/fanta mexican/i, "Mexican Fanta"],
  [/sprite mexican/i, "Mexican Sprite"],
  [/^water|spring water|crystal geyser/i, "Water"],
  [/gloves?/i, "Gloves"],
  [/cup pet 20 ?oz|20 ?oz cup/i, "20 oz cups"],
  [/lid .*20 ?oz/i, "20 oz lids"],
  [/cup plastic 10 ?oz|10 ?oz cup/i, "10 oz cups"],
  [/cup portion .*2 ?oz/i, "2 oz sauce cups"],
  [/lid portion/i, "Sauce cup lids"],
  [/fork/i, "Forks"],
  [/napkin/i, "Napkins"],
  [/bag .*logo|logo bag|ptsbchrisneddy/i, "Logo bags"],
  [/t-?shirt/i, "Plain t-shirt bags"],
  [/multifold|towel/i, "Paper towels"],
  [/tray food paper|red check/i, "Red check fry trays"],
  [/4-cup carrier|cup carrier/i, "Drink carriers"],
  [/lid .*burrito/i, "Burrito bowl lids"],
  [/bowl pulp/i, "Burrito bowls"],
]

export function plainName(raw: string): string {
  for (const [re, name] of RULES) if (re.test(raw)) return name
  const t = raw.trim()
  return t ? t[0].toUpperCase() + t.slice(1) : t
}
