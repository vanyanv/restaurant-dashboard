/**
 * Arm: token-overlap
 *
 * FROZEN HISTORICAL BASELINE — deliberately duplicated, not shared-imported.
 *
 * This is a byte-for-byte port of the "smart suggest" scoring at
 * src/app/dashboard/ingredients/components/match-picker-sheet.tsx:114-132
 * (Jaccard-over-tokens, threshold 0.25), plus its `tokenSet` (line 737) and
 * `prettifyIngredientName` (src/app/dashboard/recipes/components/
 * ingredient-picker-utils.ts:155-215) helpers. The project owner made this
 * call explicitly: this arm exists to measure what actually shipped to
 * production as of 2026-07-28. If the live component's heuristic changes
 * later, this eval baseline must NOT change with it — otherwise the bake-off
 * stops being a comparison against a fixed status quo. Extracting a shared
 * helper would also couple production UI code (a "use client" React
 * component) to a plain node/tsx eval script. Do not "clean this up" into an
 * import; if the production heuristic is intentionally re-baselined, copy it
 * here again on purpose.
 *
 * Split into its own file (out of arms.ts) purely to keep files under the
 * 400-line limit — this arm shares nothing with the vector arms besides the
 * generic rankedTopAndMargin helper and SHORTLIST_FOR_STORAGE constant.
 */

import type { MatchCandidate } from "../../src/lib/ingredient-match-scoring"
import { type Arm, rankedTopAndMargin, SHORTLIST_FOR_STORAGE } from "./arms"

function prettifyIngredientName(raw: string): string {
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
  const small = new Set(["and", "or", "of", "the", "for", "to", "in", "on", "with", "a", "an"])
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

function tokenSet(s: string): Set<string> {
  const tokens = s
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3)
  // Drop common pack/size/noise words so they don't inflate overlap.
  const noise = new Set([
    "bag",
    "box",
    "case",
    "can",
    "ctn",
    "jar",
    "pack",
    "pkt",
    "cnt",
    "count",
    "carton",
    "tray",
    "bunch",
    "each",
    "dozen",
    "the",
    "and",
    "for",
    "with",
    "fresh",
    "frozen",
  ])
  return new Set(tokens.filter((t) => !noise.has(t)))
}

const TOKEN_OVERLAP_THRESHOLD = 0.25

function scoreTokenOverlap(productName: string, canonicalName: string): number {
  const productTokens = tokenSet(prettifyIngredientName(productName))
  if (productTokens.size === 0) return 0
  const nameTokens = tokenSet(canonicalName)
  if (nameTokens.size === 0) return 0
  const overlap = [...productTokens].filter((t) => nameTokens.has(t)).length
  return overlap / Math.max(productTokens.size, nameTokens.size)
}

export const tokenOverlapArm: Arm = {
  name: "token-overlap",
  async resolve(cases, ctx) {
    // Pantry name list, scoped to the account — same source table the
    // vector arm searches, just read as plain rows instead of via <=>.
    // ORDER BY pins down row order deterministically. It doesn't change
    // *which* rows come back, but it makes the input to rankedTopAndMargin's
    // stable sort reproducible — without it, Postgres gives no guaranteed
    // row order for an unordered SELECT, so a tie between two identically-
    // scored candidates could resolve differently between runs.
    const pantry = await ctx.prisma.$queryRawUnsafe<Array<{ canonicalIngredientId: string; name: string }>>(
      `SELECT "canonicalIngredientId", "name"
         FROM "CanonicalIngredientEmbedding"
        WHERE "accountId" = $1
        ORDER BY "canonicalIngredientId"`,
      ctx.accountId,
    )

    const results = []
    for (const c of cases) {
      const scored: MatchCandidate[] = pantry.map((p) => ({
        canonicalIngredientId: p.canonicalIngredientId,
        name: p.name,
        score: scoreTokenOverlap(c.productName, p.name),
      }))
      const { sorted, topScore, margin } = rankedTopAndMargin(scored)
      const top10 = sorted.slice(0, SHORTLIST_FOR_STORAGE)
      const winner = sorted[0]

      // Mirrors the production heuristic's own decision rule: it only ever
      // surfaces candidates with score > 0.25 as suggestions. No margin or
      // ambiguity concept exists in the shipped heuristic, so the eval
      // decision is binary: the top-scoring candidate above the bar is what
      // a user would see suggested first, or nothing clears the bar at all.
      if (winner && winner.score > TOKEN_OVERLAP_THRESHOLD) {
        results.push({
          caseId: c.id,
          expectedCanonicalId: c.expectedCanonicalId,
          decision: "auto" as const,
          chosenCanonicalId: winner.canonicalIngredientId,
          correct: winner.canonicalIngredientId === c.expectedCanonicalId,
          topScore,
          margin,
          candidates: top10,
        })
      } else {
        results.push({
          caseId: c.id,
          expectedCanonicalId: c.expectedCanonicalId,
          decision: "new" as const,
          chosenCanonicalId: null,
          correct: null,
          topScore,
          margin,
          candidates: top10,
        })
      }
    }
    return results
  },
}
