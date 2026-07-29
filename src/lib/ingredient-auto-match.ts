// Entry point for the invoice-line auto-match ladder. Runs AFTER the
// deterministic matcher (`matchNewLineItems` in ingredient-matching.ts) —
// this module only ever sees whatever that pass left with
// `canonicalIngredientId: null`.
//
// This file is deliberately thin: group the unmatched lines, hand them to
// the retrieval ladder (ingredient-auto-match-ladder.ts — L1 exact name, L2
// vector, L3 LLM adjudication, see that file for the full per-layer
// description including suppression and error-isolation behavior), then
// hand whatever it resolved to the write-back phase
// (ingredient-auto-match-persist.ts — real writes, or shadow-only decision
// rows). AUTO_CREATE_ENABLED is asserted false here because this is the
// one place a future L4 could be wired in: there is no auto-create path
// anywhere in this module, and a "new" classification is left for review
// exactly like "ambiguous".
//
// This function does not throw for a provider blip or a single group's
// write failing — see the ladder/persist modules for how those degrade to
// "leave for review" plus `result.failed` instead. It is NOT exception-safe
// end to end, though: the read-only setup queries (this file's own
// `invoice.findMany` below, plus `ingredientMatchDecision.findMany`,
// `canonicalIngredient.findMany`, and `ingredientAlias.findMany` inside
// runLadder) are unwrapped and will throw straight out of this function on
// a DB error. That's deliberate, not an oversight — all four run before any
// write, so there's no partial-state hazard, just an ungraceful failure the
// caller has to handle. Wrap them (or don't) based on what Task 11's caller
// actually needs.

import { prisma } from "@/lib/prisma"
import { AUTO_CREATE_ENABLED } from "@/lib/ingredient-match-scoring"
import { groupUnmatchedLines } from "@/lib/ingredient-auto-match-core"
import { runLadder } from "@/lib/ingredient-auto-match-ladder"
import { persistResolvedGroups } from "@/lib/ingredient-auto-match-persist"

export type AutoMatchResult = {
  scanned: number
  autoExact: number
  autoVector: number
  autoLlm: number
  leftForReview: number
  costsUpdated: number
  llmCalls: number
  /** Line items whose group hit a real error (embedding call, vector
   * retrieval, or write-back transaction) rather than a genuine "no
   * confident match". Always a subset of `leftForReview`. */
  failed: number
}

export async function autoResolveUnmatchedLines(
  scope: { accountId: string; ownerId: string },
  invoiceIds: string[],
  opts?: { mode?: "shadow" | "on" }
): Promise<AutoMatchResult> {
  // There is no auto-create path in this module — a "new" classification is
  // routed to review exactly like "ambiguous". This assertion exists so
  // that fact stays visible: it fires if AUTO_CREATE_ENABLED is ever
  // flipped without this file being revisited, rather than silently doing
  // nothing (or worse, silently starting to invent canonicals).
  if (AUTO_CREATE_ENABLED) {
    throw new Error(
      "ingredient-auto-match: AUTO_CREATE_ENABLED is true but this module has no L4 auto-create path implemented"
    )
  }

  const shadow = opts?.mode === "shadow"
  const result: AutoMatchResult = {
    scanned: 0,
    autoExact: 0,
    autoVector: 0,
    autoLlm: 0,
    leftForReview: 0,
    costsUpdated: 0,
    llmCalls: 0,
    failed: 0,
  }
  if (invoiceIds.length === 0) return result

  const { accountId, ownerId } = scope

  const invoices = await prisma.invoice.findMany({
    where: { id: { in: invoiceIds }, accountId },
    select: {
      vendorName: true,
      storeId: true,
      lineItems: {
        where: { canonicalIngredientId: null },
        select: { id: true, sku: true, productName: true, unit: true },
      },
    },
  })

  const groups = groupUnmatchedLines(invoices)
  result.scanned = groups.reduce((n, g) => n + g.lineItemIds.length, 0)
  if (groups.length === 0) return result

  const ladder = await runLadder({ accountId, ownerId, groups })
  result.llmCalls = ladder.llmCalls
  result.failed += ladder.failed

  const persisted = await persistResolvedGroups({
    accountId,
    ownerId,
    resolved: ladder.resolved,
    shadow,
  })
  result.failed += persisted.failed
  result.costsUpdated = persisted.costsUpdated

  // Only groups that actually finished their write count toward these
  // summaries — a write-back failure correctly falls out of
  // autoExact/autoVector/autoLlm and into leftForReview instead of being
  // reported as applied.
  for (const r of persisted.applied) {
    const n = r.group.lineItemIds.length
    if (r.layer === "auto-exact") result.autoExact += n
    else if (r.layer === "auto-vector") result.autoVector += n
    else result.autoLlm += n
  }
  result.leftForReview = result.scanned - (result.autoExact + result.autoVector + result.autoLlm)

  return result
}
