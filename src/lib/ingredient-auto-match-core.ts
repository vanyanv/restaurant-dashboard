// Pure helpers for the invoice-line auto-match ladder
// (`ingredient-auto-match.ts`). No Prisma, no network — everything here is
// plain data in, plain data out, so the grouping key and the LLM-acceptance
// gate can be reasoned about (and, if ever needed, unit-tested) independent
// of the orchestration's I/O.

import { normalizeVendorName } from "@/lib/vendor-normalize"
import type { MatchCandidate } from "@/lib/ingredient-match-scoring"
import type { AdjudicatorDraft } from "@/lib/ingredient-match-llm"

export type UnmatchedLine = {
  id: string
  sku: string | null
  productName: string
  unit: string | null
}

export type InvoiceForGrouping = {
  vendorName: string
  storeId: string | null
  lineItems: UnmatchedLine[]
}

/** One group of unmatched line items that share a (vendor, product name) key.
 * `vendorName` is already normalized. `productName`, `unit`, `sku`, and
 * `storeId` are taken from whichever line item was seen first for this key
 * — the "sample line" the brief refers to for the sku/alias learn step. */
export type LineGroup = {
  groupKey: string
  vendorName: string
  productName: string
  unit: string | null
  sku: string | null
  storeId: string | null
  lineItemIds: string[]
}

/**
 * The same key the offline evaluation measured — NOT the review inbox's
 * sku-based key (`listUnmatchedLineItems`'s `key`). Groups purely by
 * normalized vendor + lowercased product name, so it deliberately ignores
 * sku: two different skus for what is textually the same product name
 * collapse into one group, and the sample line (first seen) decides which
 * sku (if any) gets learned into `IngredientSkuMatch`.
 *
 * `normalizeVendorName` only canonicalizes six hardcoded vendors and returns
 * `raw.trim()` for everything else (a known, separately-tracked defect) — so
 * two spellings of the same real-world vendor that aren't one of those six
 * produce two different groups here. That is inherited, not introduced.
 */
export function buildGroupKey(normalizedVendor: string, productName: string): string {
  return `${normalizedVendor}::name::${productName.trim().toLowerCase()}`
}

/** Group unmatched line items across one batch of invoices by
 * `buildGroupKey`. Order of `lineItemIds` follows input order; order of
 * returned groups follows first-appearance order. */
export function groupUnmatchedLines(invoices: InvoiceForGrouping[]): LineGroup[] {
  const byKey = new Map<string, LineGroup>()
  for (const inv of invoices) {
    const vendor = normalizeVendorName(inv.vendorName)
    for (const li of inv.lineItems) {
      const groupKey = buildGroupKey(vendor, li.productName)
      let group = byKey.get(groupKey)
      if (!group) {
        group = {
          groupKey,
          vendorName: vendor,
          productName: li.productName,
          unit: li.unit,
          sku: li.sku,
          storeId: inv.storeId,
          lineItemIds: [],
        }
        byKey.set(groupKey, group)
      }
      group.lineItemIds.push(li.id)
    }
  }
  return [...byKey.values()]
}

/** Key for the UNDONE-decision suppression set — never re-link this exact
 * (group, canonical) pairing, at any layer. */
export function suppressionKey(groupKey: string, canonicalIngredientId: string): string {
  return `${groupKey}::${canonicalIngredientId}`
}

export type AutoMatchMode = "off" | "shadow" | "on"

/**
 * Read the `INGREDIENT_AUTO_MATCH` rollout gate.
 *
 * Fails safe in both directions: unset, blank, or ANY unrecognised value is
 * `off`. That matters more than it looks — the plausible operator typos
 * ("true", "1", "yes", "enabled") are exactly the strings a truthiness check
 * would read as consent to start writing canonical links on every invoice
 * sync. Only the two documented words turn anything on, and only `on` writes.
 */
export function resolveAutoMatchMode(raw: string | undefined): AutoMatchMode {
  switch (raw?.trim().toLowerCase()) {
    case "on":
      return "on"
    case "shadow":
      return "shadow"
    default:
      return "off"
  }
}

export type Layer = "auto-exact" | "auto-vector" | "auto-llm"

/** One group the ladder decided to link, before write-back. Shared between
 * the retrieval phase (ingredient-auto-match-ladder.ts, which produces
 * these) and the persistence phase (ingredient-auto-match-persist.ts, which
 * consumes them). */
export type ResolvedGroup = {
  group: LineGroup
  canonicalIngredientId: string
  layer: Layer
  confidence: number
  /** Best vector similarity seen for this group, regardless of which
   * candidate was ultimately accepted — null at L1 (no vector score
   * exists). At L2 this is necessarily the accepted candidate's own score
   * (it won by being the top). At L3 it's the shortlist's own top score,
   * which may differ from the accepted candidate's score since the LLM can
   * pick a lower-ranked shortlist member. */
  topScore: number | null
  margin: number | null
  candidates: Array<{ id: string; name: string; score: number }> | null
  model: string | null
  reasoning: string | null
}

/**
 * A group the ladder DECLINED to link, plus the best candidate it saw. Not a
 * match — a note for the human who will decide, recorded so the review inbox
 * can pre-fill the pick instead of making them search for it again.
 *
 * `layer` says which rung produced the candidate: `suggest-vector` when the
 * similarity search's top pick simply didn't clear the gate, `suggest-llm`
 * when the adjudicator named it but below `LLM_ACCEPT`. Keeping them distinct
 * matters — a rejected LLM pick carries reasoning worth reading, and it is
 * also the weaker of the two signals.
 */
export type SuggestedGroup = {
  group: LineGroup
  canonicalIngredientId: string
  layer: "suggest-vector" | "suggest-llm"
  /** The candidate's own similarity score, not a model confidence. */
  score: number
  /** The adjudicator's reasoning when it looked at this group at all. */
  reasoning: string | null
  model: string | null
  candidates: MatchCandidate[]
}

/** Format raw vector candidates for the `IngredientMatchDecision.candidates`
 * Json column (the undo UI's "here's what else it considered" list). */
export function candidateJson(
  candidates: MatchCandidate[] | null
): Array<{ id: string; name: string; score: number }> | null {
  if (!candidates) return null
  return candidates.map((c) => ({ id: c.canonicalIngredientId, name: c.name, score: c.score }))
}

export type AcceptedLlmMatch = {
  canonicalIngredientId: string
  name: string
  score: number
}

/**
 * The L3 acceptance gate. Fails safe on every path: no draft for this case,
 * a null `matchName` (the model's "none of these" / propose-new signal —
 * there is no auto-create path to route it to), a confidence below
 * `llmAccept`, or a name that doesn't resolve to a member of THIS group's
 * own shortlist (the model hallucinated or borrowed a name from another
 * case's list) all return `null` — leave the group for a human.
 */
export function resolveLlmDraft(input: {
  shortlist: MatchCandidate[]
  draft: AdjudicatorDraft | undefined
  llmAccept: number
}): AcceptedLlmMatch | null {
  const { shortlist, draft, llmAccept } = input
  if (!draft) return null
  if (draft.matchName === null) return null
  // `!(confidence >= llmAccept)` rather than `confidence < llmAccept`: this
  // is the gate on untrusted model output, and `NaN < llmAccept` is `false`
  // — a `<` comparison fails OPEN on a NaN confidence, silently accepting
  // it. The parser already filters non-finite values before a draft ever
  // reaches here, but that's the parser's contract, not this gate's; this
  // gate must hold on its own.
  if (!(draft.confidence >= llmAccept)) return null
  const hit = shortlist.find((c) => c.name === draft.matchName)
  if (!hit) return null
  return { canonicalIngredientId: hit.canonicalIngredientId, name: hit.name, score: hit.score }
}

/**
 * The L1 cross-scope exact-name lookup, decided from two pre-built indexes
 * (canonical name -> set of canonical ids sharing that lowercased name, and
 * alias rawName -> set of canonical ids sharing that lowercased rawName —
 * see the caller for why these must be *sets*, not single ids).
 *
 * Canonical direct-name hits take priority over alias hits (an ingredient's
 * own name is stronger evidence than a learned alias), but either kind of
 * hit is only usable when it names exactly one canonical: `size > 1` means
 * this normalized name is genuinely ambiguous at this account and must be
 * scored (L2), not guessed.
 */
export function resolveExactMatch(
  normalizedName: string,
  canonicalByName: Map<string, Set<string>>,
  aliasByName: Map<string, Set<string>>
): { canonicalIngredientId: string } | { ambiguous: true } | null {
  const canonicalHit = canonicalByName.get(normalizedName)
  if (canonicalHit) {
    return canonicalHit.size === 1 ? { canonicalIngredientId: [...canonicalHit][0] } : { ambiguous: true }
  }
  const aliasHit = aliasByName.get(normalizedName)
  if (aliasHit) {
    return aliasHit.size === 1 ? { canonicalIngredientId: [...aliasHit][0] } : { ambiguous: true }
  }
  return null
}
