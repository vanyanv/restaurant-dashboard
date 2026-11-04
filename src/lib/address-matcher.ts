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

function normalizeAddress(address: string): string {
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

    let word = words[i]

    // A street number fused to one letter ("1360E COLORADO ST", "14523A
    // Sherman Way") is the number followed by a directional or a unit letter
    // the vendor printed without a space. Read whole, "1360e" is a different
    // street number from the store's 1360, and two Glendale Premier Meats
    // invoices (2026-10-29, 2026-11-02) sat in review at 75% for it. Split it
    // here so the letter takes the same path as "1360 E" below.
    if (result.length === 0) {
      const fused = word.match(/^(\d+)([a-z])$/)
      if (fused) {
        result.push(fused[1])
        word = fused[2]
      }
    }

    // Strip unit identifiers and their following number
    if (STRIP_WORDS.has(word)) {
      skipNext = true
      continue
    }
    // Strip standalone # with following number
    if (word.startsWith("#")) continue

    // A lone letter right after the street number is a unit designator the
    // vendor wrote without "Suite" ("14523 A Sherman Way"). It is not part of
    // the street name, so it is dropped the way "Suite A" is.
    if (result.length === 1 && /^\d+$/.test(result[0]) && /^[a-z]$/.test(word)) continue

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

  // Street numbers must match exactly for any meaningful score — with one
  // documented exception, decided further down: a vendor that dropped or
  // added a single trailing character ("1452 A Sherman Way" for 14523) on
  // an otherwise identical street in the same ZIP. Any other mismatch is 0.
  const numA = extractStreetNumber(normA)
  const numB = extractStreetNumber(normB)
  const truncatedNumber =
    !!numA && !!numB && numA !== numB &&
    Math.abs(numA.length - numB.length) === 1 &&
    (numA.startsWith(numB) || numB.startsWith(numA))
  if (numA && numB && numA !== numB && !truncatedNumber) return 0

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

  // The truncated-number exception: same ZIP, same street (the rest of the
  // address agrees), and a number one character short or long. Scored just
  // over the match threshold and well under 1.0, so a store whose number
  // matches exactly always wins, and the row still reads as a fuzzy match.
  // Seen live on 2026-10-25: six Van Nuys invoices addressed to
  // "1452 A SHERMAN WAY, VAN NUYS, CA 91405" for 14523 Sherman Way.
  if (truncatedNumber) {
    return zipA && zipA === zipB && stringSimilarity >= 0.6 ? 0.75 : 0
  }

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
 * Confidence given to a fuzzy match that `verifyByStreetAndZip` has proved.
 * Over the 0.85 auto-match line and under 1.0, so an exact match still wins
 * and the row still reads as a match that needed the second check.
 */
export const VERIFIED_FUZZY_CONFIDENCE = 0.9

/**
 * Prove a fuzzy store match from the parts of an address that identify a
 * place, instead of leaving it for someone to confirm.
 *
 * A match the similarity score puts under 0.85 is verified when ALL of these
 * hold, and only then:
 *   - the invoice prints a 5-digit ZIP and it is this store's ZIP;
 *   - no other store on the account is in that ZIP, so the ZIP cannot point
 *     anywhere else;
 *   - the street number is this store's, or the store's with one character
 *     missing or extra (IFS prints "1452 A Sherman Way" for 14523);
 *   - the street name and city after the number agree (similarity ≥ 0.8).
 *
 * Nothing is inferred that the document does not say: each test compares
 * printed text with the store's own address. When any test fails the match
 * keeps its score and the invoice is not auto-matched.
 */
export function verifyByStreetAndZip(
  deliveryAddress: string,
  storeAddress: string,
  otherStoreAddresses: string[],
): boolean {
  const inv = normalizeAddress(deliveryAddress)
  const st = normalizeAddress(storeAddress)
  const zip = extractZip(inv)
  if (!zip || extractZip(st) !== zip) return false
  if (otherStoreAddresses.some((a) => extractZip(normalizeAddress(a)) === zip)) return false

  const numInv = extractStreetNumber(inv)
  const numSt = extractStreetNumber(st)
  if (!numInv || !numSt) return false
  const sameNumber =
    numInv === numSt ||
    (Math.abs(numInv.length - numSt.length) === 1 &&
      (numInv.startsWith(numSt) || numSt.startsWith(numInv)))
  if (!sameNumber) return false

  // The words between the number and the ZIP: street name, city, state.
  const streetOf = (a: string) =>
    a.replace(/^\d+[\w-]*\s*/, "").replace(/\b\d{5}(?:-\d{4})?\b.*$/, "").trim()
  const a = streetOf(inv)
  const b = streetOf(st)
  if (!a || !b) return false
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length) >= 0.8
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

  if (best && best.confidence < VERIFIED_FUZZY_CONFIDENCE) {
    const chosen = best
    const store = stores.find((s) => s.id === chosen.storeId)
    const others = stores
      .filter((s) => s.id !== chosen.storeId && s.address)
      .map((s) => s.address as string)
    if (store?.address && verifyByStreetAndZip(deliveryAddress, store.address, others)) {
      best = { storeId: chosen.storeId, confidence: VERIFIED_FUZZY_CONFIDENCE }
    }
  }

  return best
}
