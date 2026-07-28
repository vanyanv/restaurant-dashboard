/**
 * Gold labels this round audited against production and found not to be a
 * fair test of the matcher (round-4, points 1 and 3).
 *
 * These are NOT removed from the gold set — `gold.ts` is frozen and builds the
 * answer key straight from `InvoiceLineItem.canonicalIngredientId`, exactly as
 * it should. This module only lets the *report* show the pooled result a
 * second time with them excluded, clearly labeled, alongside the as-is
 * numbers. Nothing is ever silently dropped: every entry below is printed in
 * the report with its evidence, and the as-is table is always shown first.
 *
 * The audit was read-only. No production row was modified.
 *
 * No I/O.
 */

export type DisputedKind =
  /** The gold label itself is wrong — production has the line pointed at the
   * wrong canonical, so the matcher was scored against a bad answer. */
  | "mislabeled-gold"
  /** The gold label is correct, but two near-identical pantry rows make the
   * case unwinnable from the product name alone — no matcher can pick right. */
  | "unwinnable-pantry-duplicate"

export type DisputedLabel = {
  caseId: string
  kind: DisputedKind
  productName: string
  /** What the gold set (i.e. production) currently says the answer is. */
  goldSays: string
  /** What the evidence says the answer plainly should be. */
  shouldBe: string
  evidence: string
}

/**
 * All three entries were established by direct read-only query against the
 * live database (invoice 12840200 and the full price history of skus
 * G7234/G7244/G7246), not inferred from the eval output.
 */
export const DISPUTED_LABELS: DisputedLabel[] = [
  {
    caseId: "Individual FoodService::name::soda sprite mexican cocas crv inc",
    kind: "mislabeled-gold",
    productName: "SODA SPRITE MEXICAN COCAS CRV INC",
    goldSays: "soda coke mexican glass",
    shouldBe: "soda sprite mexican glass crv inc",
    evidence:
      "Invoice 12840200 (2026-07-27), line 2. Its sku reads G7234 (= coke), but G7234 has billed at $46.57/case on " +
      "all 34 prior lines and this line billed at $43.01 — the sprite/fanta price. Line 1 of the same invoice also " +
      "carries G7234, and no line carries G7246 at all: the sku column is shifted down one row across lines 2-3 " +
      "(line 2 inherited line 1's sku, line 3 inherited line 2's; line 1's own sku is correct). Product name and unit price agree with each " +
      "other and disagree with the sku, so the sku — and therefore the canonical derived from it — is the wrong " +
      "column. Real answer: sprite.",
  },
  {
    caseId: "Individual FoodService::name::soda orange fanta mexican",
    kind: "mislabeled-gold",
    productName: "SODA ORANGE FANTA MEXICAN",
    goldSays: "soda sprite mexican glass crv inc",
    shouldBe: "soda orange fanta mexican glass",
    evidence:
      "Invoice 12840200 (2026-07-27), line 3 — the next step of the same one-row sku shift. Its sku reads G7244 " +
      "(= sprite), which line 2 should have had; G7246 (= orange fanta), present on every other multi-soda invoice " +
      "in the account, is missing from this one entirely. The product name says orange fanta and the $43.01 unit " +
      "price is consistent with it. Real answer: orange fanta.",
  },
  {
    caseId: "Individual FoodService::name::mustard packets",
    kind: "unwinnable-pantry-duplicate",
    productName: "Mustard Packets",
    goldSays: "mustard packets 5.5gr",
    shouldBe: "mustard packets 5.5gr (the gold label is correct — the case is simply unwinnable)",
    evidence:
      "The pantry holds two rows for one ingredient: `mustard packets 5.5gr` (18 invoice lines, all sku G106) and " +
      "`mustard packets 5.5 g` (1 invoice line, sku G108, created 6s later in the same seeding batch). They differ " +
      "only in how the unit is spelled. The query \"Mustard Packets\" is a token subset of both and scores 1.0000 " +
      "against the duplicate versus 0.6667 against the correct row, so token-overlap is forced into the wrong one. " +
      "The gold label is right; there is no signal in the product name that could distinguish the two, so scoring " +
      "any matcher on it measures the pantry's duplicate, not the matcher.",
  },
]

const DISPUTED_IDS = new Set(DISPUTED_LABELS.map((d) => d.caseId))

export function isDisputed(caseId: string): boolean {
  return DISPUTED_IDS.has(caseId)
}

/** Drop the disputed cases from any list keyed by `caseId` — arm results or
 * gold cases. Used only to produce the clearly-labeled second pooled table. */
export function excludeDisputed<T extends { caseId: string }>(items: T[]): T[] {
  return items.filter((i) => !DISPUTED_IDS.has(i.caseId))
}

/** Same, for GoldCase[] (keyed by `id`, not `caseId`). */
export function excludeDisputedCases<T extends { id: string }>(items: T[]): T[] {
  return items.filter((i) => !DISPUTED_IDS.has(i.id))
}
