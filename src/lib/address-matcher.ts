const ABBREVIATIONS: Record<string, string> = {
  st: "street",
  ave: "avenue",
  blvd: "boulevard",
  dr: "drive",
  ln: "lane",
  rd: "road",
  ct: "court",
  pl: "place",
  pkwy: "parkway",
  hwy: "highway",
  cir: "circle",
  trl: "trail",
  ter: "terrace",
  n: "north",
  s: "south",
  e: "east",
  w: "west",
  ne: "northeast",
  nw: "northwest",
  se: "southeast",
  sw: "southwest",
}

// Words to strip (unit identifiers)
const STRIP_WORDS = new Set(["ste", "suite", "apt", "unit", "floor", "fl", "#"])

export function normalizeAddress(address: string): string {
  let normalized = address.toLowerCase().trim()

  // Remove punctuation except hyphens in numbers
  normalized = normalized.replace(/[.,;:'"!?()]/g, "")

  // Split into words
  const words = normalized.split(/\s+/)
  const result: string[] = []
  let skipNext = false

  for (let i = 0; i < words.length; i++) {
    if (skipNext) {
      skipNext = false
      continue
    }

    const word = words[i]

    // Strip unit identifiers and their following number
    if (STRIP_WORDS.has(word)) {
      skipNext = true
      continue
    }
    // Strip standalone # with following number
    if (word.startsWith("#")) continue

    // Expand abbreviations
    const expanded = ABBREVIATIONS[word]
    result.push(expanded ?? word)
  }

  return result.join(" ")
}

/** Extract the street number from a normalized address. */
function extractStreetNumber(normalized: string): string | null {
  const match = normalized.match(/^(\d+[\w-]*)/)
  return match ? match[1] : null
}

/** Extract the 5-digit ZIP code from a normalized address, ignoring any +4 extension. */
function extractZip(normalized: string): string | null {
  const match = normalized.match(/\b(\d{5})(?:-\d{4})?\b/g)
  if (!match) return null
  // Last 5-digit block is almost always the ZIP (street numbers appear earlier).
  const last = match[match.length - 1]
  return last.slice(0, 5)
}

/** Levenshtein distance between two strings. */
function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))

  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }

  return dp[m][n]
}

/** Compute similarity between two addresses (0 to 1). */
export function addressSimilarity(a: string, b: string): number {
  const normA = normalizeAddress(a)
  const normB = normalizeAddress(b)

  if (normA === normB) return 1.0

  // Street numbers must match exactly for any meaningful score
  const numA = extractStreetNumber(normA)
  const numB = extractStreetNumber(normB)
  if (numA && numB && numA !== numB) return 0

  // US addresses are uniquely identified by street number + 5-digit ZIP.
  // If both match, cosmetic differences (city spelling, directional abbrev,
  // ZIP+4 suffix) don't change the physical location.
  const zipA = extractZip(normA)
  const zipB = extractZip(normB)
  if (numA && numA === numB && zipA && zipA === zipB) return 1.0

  // Compare the rest after removing the street number
  const restA = normA.replace(/^\d+[\w-]*\s*/, "")
  const restB = normB.replace(/^\d+[\w-]*\s*/, "")

  if (!restA || !restB) return numA === numB ? 0.5 : 0

  const maxLen = Math.max(restA.length, restB.length)
  const dist = levenshtein(restA, restB)
  const stringSimilarity = 1 - dist / maxLen

  // Bonus if both have a matching number, extra bonus if ZIPs match
  const numberBonus = numA && numA === numB ? 0.1 : 0
  const zipBonus = zipA && zipA === zipB ? 0.1 : 0

  return Math.min(1, stringSimilarity + numberBonus + zipBonus)
}

export interface StoreMatch {
  storeId: string
  confidence: number
}

/**
 * Match an invoice delivery address to the best-matching store.
 * Returns null if no store exceeds the confidence threshold.
 */
export function matchInvoiceToStore(
  deliveryAddress: string,
  stores: Array<{ id: string; address: string | null }>,
  threshold = 0.7
): StoreMatch | null {
  let best: StoreMatch | null = null

  for (const store of stores) {
    if (!store.address) continue
    const confidence = addressSimilarity(deliveryAddress, store.address)
    if (confidence >= threshold && (!best || confidence > best.confidence)) {
      best = { storeId: store.id, confidence }
    }
  }

  return best
}
