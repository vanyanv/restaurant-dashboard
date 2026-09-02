"use server"

import {
  acceptMappingProposal,
  generateMappingProposals,
  listMappingProposals,
  rejectMappingProposal,
} from "@/app/actions/mapping-proposal-actions"

/**
 * The Counter layer's write path for AI mapping proposals.
 *
 * `RecipeMappingProposal` holds seven rejected and three accepted rows and
 * NOTHING pending, which is why `menu-catalog.ts` notes that "the prototype's
 * 'Five AI mapping proposals are waiting' has nothing behind it" and gives the
 * slot to unmapped items instead. That note is still true of the DATA. It was
 * never true of the CAPABILITY: `generateMappingProposals`,
 * `acceptMappingProposal` and `rejectMappingProposal` have all existed the
 * whole time and the editorial `proposal-review-launcher.tsx` called all three.
 *
 * So the queue is empty because nothing has asked it to fill, not because it
 * cannot. The generator's candidates are the items sold in the last 30 days
 * with no recipe — 7 of the 62 names currently selling, not the 97 of 155 that
 * an all-time count reports and that mostly stopped selling long ago.
 *
 * ## GENERATING COSTS MONEY AND THE PAGE SAYS SO
 *
 * `generateMappingProposalsCore` resolves what it can for free — a normalised
 * exact name match becomes a MATCH proposal with no model call — and sends
 * only the fuzzy remainder to the LLM. It is still a billed call per remaining
 * item, so the control names the cost rather than hiding it behind a verb, and
 * nothing on this page generates on its own.
 *
 * Items already PENDING or REJECTED are skipped by the core: a human who has
 * said no once is not asked again about the same item, which is what keeps a
 * repeated press from re-proposing the same rejections forever.
 */
export interface PendingProposal {
  id: string
  item: string
  proposed: string | null
  /** "MATCH" when it points at an existing recipe; otherwise a new-recipe draft. */
  kind: string
  /** 0–1 from the model, or null for the free exact-name layer. */
  confidence: number | null
  reasoning: string
}

export async function loadPendingProposals(): Promise<PendingProposal[]> {
  const rows = await listMappingProposals()
  return rows.map((r) => ({
    id: r.id,
    item: r.otterItemName,
    proposed: r.proposedRecipeName ?? r.payload?.suggestedName ?? null,
    kind: r.kind,
    confidence: r.confidence,
    reasoning: r.payload?.reasoning ?? "",
  }))
}

export async function decideProposal(
  proposalId: string,
  outcome: "accept" | "reject",
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (outcome === "accept") {
    const result = await acceptMappingProposal(proposalId)
    if (!result.ok) return { ok: false, error: result.error }
    return { ok: true }
  }
  /*
   * `rejectMappingProposal` returns a bare `{ ok: boolean }` with no reason —
   * an older convention in `@/app/actions`. The three cases it collapses are
   * "not signed in", "not yours" and "already decided", and the third is the
   * one a reader will actually hit (two tabs, or a double press). The message
   * says that rather than inventing a distinction the action does not make.
   */
  const result = await rejectMappingProposal(proposalId)
  if (!result.ok) return { ok: false, error: "already decided, or not yours" }
  return { ok: true }
}

export async function proposeMatches(): Promise<
  { ok: true; created: number; skipped: number } | { ok: false; error: string }
> {
  const result = await generateMappingProposals({})
  if (!result.ok) return { ok: false, error: result.error }
  return { ok: true, created: result.created, skipped: result.skippedExisting }
}
