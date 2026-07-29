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
 * Certified 2026-07-28 by the ingredient-auto-match offline evaluation
 * (scripts/eval-ingredient-match, frozen — never re-run to produce these
 * numbers). Owner's ship decision: vector similarity gates auto-link, a
 * gpt-5.4-nano adjudicator resolves the ambiguous band, auto-create is
 * disabled. Every number below traces to a specific run report; do not
 * hand-tune any of these without a new certified evaluation.
 *
 * - HIGH = 0.72, MARGIN = 0.01 — the cross-fold median vector ship gate,
 *   scripts/eval-ingredient-match/runs/2026-07-28-1748.md ("Grouped k-fold
 *   validation", `median` rule, as-is case set): 167/255 auto-linked,
 *   0 wrong, 65.5% coverage, 100% precision. That row is the full 255-case
 *   gold set scored once at this one shared gate — NOT cross-validated,
 *   per the report's own caveat. The leakage-free cross-validated estimate
 *   (`permissive` rule, one gate per fold) is 166/255 auto-linked, 0 wrong,
 *   65.1% coverage — nearly identical, and it is this second figure that
 *   should be quoted as "the" tested error rate.
 *
 * - LLM_ACCEPT = 0.78 — gpt-5.4-nano's confidence-acceptance threshold, the
 *   value 4 of 5 grouped-k-fold folds independently selected on their own
 *   tuning data (fold 0 alone picked 0.72),
 *   scripts/eval-ingredient-match/runs/2026-07-28-1646-llm.md (arm
 *   gpt-5.4-nano, "excluding disputed gold labels" tables — the disputed
 *   labels are known-corrupted gold, not a favorable cherry-pick). The
 *   cross-validated combined result (vector + adjudicator) is 234/253
 *   auto-linked, 1 wrong, 92.5% coverage, 99.6% precision. Applying tau=0.78
 *   as one fixed threshold to the whole pool in a single pass (full-sample,
 *   optimistic by construction, NOT cross-validated) reads 232/253
 *   auto-linked, 0 wrong, 91.7% coverage, 100% precision — the entire
 *   difference between "0 wrong" and "1 wrong" is one fold's threshold
 *   pick differing from the rest by 0.06.
 *
 * - FLOOR = 0.48 — the value scripts/eval-ingredient-match/runs/2026-07-28-1748.md's
 *   FLOOR sweep established as the point where the duplicate-creation
 *   ("new") count goes to zero *on the 255-case gold set* (New=0 for
 *   FLOOR<=0.48, New=1 at FLOOR=0.50; the lowest top score anywhere in that
 *   gold set is 0.4931). This lowers auto-create exposure at the scores this
 *   evaluation measured, but it does NOT make `new` unreachable in general —
 *   see AUTO_CREATE_ENABLED below for why FLOOR alone is not the safety
 *   mechanism.
 *
 * Three caveats that must travel with these numbers wherever cited:
 * 1. Cross-validated and fixed-threshold figures differ (one carries a
 *    measured error, one doesn't) — always state which is which; the
 *    fixed-threshold figure is optimistic by construction.
 * 2. Every gold case is one the deterministic SKU layer already resolves,
 *    so every figure above is an upper bound for genuinely new products,
 *    not an estimate of live performance on them.
 * 3. Safety comes from the acceptance gate, not from model reliability —
 *    at pool level gpt-5.4-nano makes 8 wrong picks out of 88 pool cases,
 *    including matching french fries to frying-oil shortening at 0.52
 *    confidence. The gate (LLM_ACCEPT) rejects picks like that; the model
 *    itself is not being trusted to be right.
 */
export const THRESHOLDS = {
  HIGH: 0.72,
  MARGIN: 0.01,
  FLOOR: 0.48,
  LLM_ACCEPT: 0.78,
} as const

/**
 * Explicit, not emergent. Auto-create is disabled by this flag — NOT by
 * FLOOR's relationship to any sample's minimum score, which is incidental.
 *
 * `classifyCandidates` returns `{ kind: "new" }` from two places: the
 * `candidates.length === 0` guard below (before FLOOR is ever consulted),
 * and `top.score < FLOOR`. Setting FLOOR under the gold set's lowest
 * observed score only closes the second path. The first fires whenever
 * vector retrieval returns zero candidates — a real, live scenario:
 * `CanonicalIngredientEmbedding` coverage has no cron and nothing writes an
 * embedding on canonical creation outside the one path Task 1 added, and
 * GLN/VNYS will open with empty pantries. At an empty pantry, EVERY
 * invoice line hits the empty-candidates path regardless of FLOOR. Any
 * caller wiring up L4 (auto-create) MUST check this flag before creating a
 * `CanonicalIngredient` from a `{ kind: "new" }` decision — checking FLOOR
 * or `candidates.length` is not sufficient on its own.
 *
 * Measured reason (owner's decision, 2026-07-28): at vector-only's own
 * zero-error ship gate (FLOOR=0.72, the pre-certification production
 * default), 33.3% of the 255-case gold set (85/255) — cases that have a
 * correct, already-existing canonical — score below FLOOR and would
 * auto-create a duplicate (scripts/eval-ingredient-match/runs/2026-07-28-1748.md,
 * vector-only "FLOOR sweep" section, FLOOR=0.72 row). That is the exposure
 * this flag exists to prevent, independent of whatever FLOOR is set to.
 */
export const AUTO_CREATE_ENABLED = false

/** Also used by ingredient-auto-match.ts to cap the raw-candidate shortlist
 * it builds for a "new"-classified group (which carries no `candidates` of
 * its own on the Classification type) — kept as one shared constant so the
 * two shortlists (ambiguous's and new's) can never silently drift apart. */
export const SHORTLIST = 5

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
