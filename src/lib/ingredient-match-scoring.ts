// Pure classification for invoice-line → canonical-ingredient matching.
// No I/O: every safety property of auto-matching is decided here and is
// therefore fully testable. Thresholds are set by the offline bake-off
// (scripts/eval-ingredient-match), never guessed in place.

export type MatchCandidate = {
  canonicalIngredientId: string
  name: string
  /** Cosine similarity 0..1 — higher is closer. */
  score: number
}

export type Classification =
  | { kind: "auto"; candidate: MatchCandidate; margin: number }
  | { kind: "ambiguous"; candidates: MatchCandidate[] }
  | { kind: "new" }

/**
 * Calibrated by scripts/eval-ingredient-match against the account's confirmed
 * matches. HIGH/MARGIN gate a silent auto-link; FLOOR gates auto-creation
 * (below it, nothing in the pantry is close enough to be a duplicate);
 * LLM_ACCEPT gates accepting the adjudicator's answer.
 */
export const THRESHOLDS = {
  HIGH: 0.9,
  MARGIN: 0.05,
  FLOOR: 0.72,
  LLM_ACCEPT: 0.85,
} as const

const SHORTLIST = 5

export function classifyCandidates(
  candidates: MatchCandidate[],
  t: { HIGH: number; MARGIN: number; FLOOR: number; LLM_ACCEPT: number } = THRESHOLDS
): Classification {
  if (candidates.length === 0) return { kind: "new" }

  const sorted = [...candidates].sort((a, b) => b.score - a.score)
  const top = sorted[0]
  if (top.score < t.FLOOR) return { kind: "new" }

  const runnerUp = sorted[1]?.score ?? 0
  const margin = top.score - runnerUp

  // Both conditions required. A high score with a close runner-up is exactly
  // the grade/size-variant case ("73/27" vs "80/20") where a silent pick is
  // worse than asking — it would move COGS with no signal that it guessed.
  if (top.score >= t.HIGH && margin >= t.MARGIN) {
    return { kind: "auto", candidate: top, margin }
  }

  return { kind: "ambiguous", candidates: sorted.slice(0, SHORTLIST) }
}

export function buildMatchQueryText(input: {
  productName: string
  vendorName: string
  unit: string | null
}): string {
  return [input.productName, input.vendorName, input.unit]
    .filter((p): p is string => !!p && p.trim().length > 0)
    .join(" | ")
}
