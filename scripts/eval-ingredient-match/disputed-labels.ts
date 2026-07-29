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
 * Every entry was established by direct read-only query against the live
 * database (invoice 12840200 and the full price history of skus
 * G7234/G7244/G7246 for the first three; sku 15725's full line history for
 * the fourth, added in task 6 fix round 1), not inferred from the eval output.
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
      "The gold label is right. CAVEAT (task 6, fix round 2): \"no signal in the product name\" overstates this — " +
      "it is a property of what the LLM adjudicator's shortlist shows (candidate name and cosine score only), not " +
      "of the underlying data. The pantry does hold a real distinguishing signal (18 invoice lines on the correct " +
      "row vs. 1 on the duplicate) that the shortlist withholds. Showing line-count or last-seen-sku per candidate " +
      "would likely make this case trivially winnable without touching the pantry at all — see task-6-report.md's " +
      "fix-round-1 point 9. Scoring any matcher against the shortlist as currently built measures the pantry's " +
      "duplicate combined with that withheld signal, not the matcher's reasoning ability in isolation.",
  },
  {
    caseId: "Vitco Foodservice::name::chris & eddy's house sce",
    kind: "mislabeled-gold",
    productName: "Chris & Eddy's House Sce",
    goldSays: "chris & eddy's house sauce cup 1.5 oz",
    shouldBe: "chris & eddy's house sauce (tentative — see the honesty note below)",
    evidence:
      "sku 15725 has 16 invoice lines total, all unit CS, all the same price — strong evidence it is one physical " +
      "item throughout. Scoping precisely to the exact case-insensitive text 'Chris & Eddy's House Sce' (excluding " +
      "the sibling variants 'Chris & Eddy's House' [1 line] and '...House Sce 180C' [2 lines], which are separate, " +
      "undisputed gold cases each seen under only one vendor casing): 3 lines (2026-04-23, 2026-05-26, 2026-05-30) " +
      "carry vendorName 'Vitco Foodservice' and map to `house sauce cup 1.5 oz`; 9 lines (2026-06-04 through " +
      "2026-07-20, ongoing) carry vendorName 'VITCO FOODSERVICE' and map to `house sauce`. `normalizeVendorName` " +
      "(src/lib/vendor-normalize.ts) returns `raw.trim()` for any vendor outside its small alias list — Vitco is " +
      "not in that list — so the two castings of the identical vendor name become two different gold-case ids for " +
      "the identical product name and sku, with opposite canonical labels. Any matcher is structurally guaranteed " +
      "to be wrong on whichever of the two it is scored against; gpt-5.5 was in fact scored wrong on both. This is " +
      "the same defect class as the two soda entries above — a corrupted label, not a hard case — not a genuine " +
      "size-variant judgment call. Separately, the same vendor-casing split also divides the unrelated sku 15185 " +
      "('fries 1/4\" ss clr ct xlf beef') into two gold cases sharing one label (8 occurrences under 'VITCO " +
      "FOODSERVICE', 2 under 'Vitco Foodservice') — harmless to scoring since both map to the same canonical, but " +
      "it means those items are not statistically independent trials, which mildly inflates every Wilson-bound " +
      "sample size that includes them. HONESTY NOTE: unlike the soda entries, this was not independently " +
      "corroborated against a source document (e.g. an invoice PDF). The direction chosen here (majority — 9 of 12 " +
      "lines — and the more recent, ongoing mapping) is the best available read of which label is more likely to " +
      "be the account's actual current intent, not a certainty. `normalizeVendorName`'s case-sensitivity is a live " +
      "production bug independent of this eval — flagged separately, not fixed here.",
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
