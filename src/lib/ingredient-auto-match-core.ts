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
  if (draft.confidence < llmAccept) return null
  const hit = shortlist.find((c) => c.name === draft.matchName)
  if (!hit) return null
  return { canonicalIngredientId: hit.canonicalIngredientId, name: hit.name, score: hit.score }
}
