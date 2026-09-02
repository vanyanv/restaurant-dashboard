"use server"

import {
  commitDecision,
  dismissDecision,
} from "@/app/actions/decisions/decision-log-actions"
import type { OpportunityType } from "@/generated/prisma/client"

/**
 * The Counter layer's write path for the Needs-you queue.
 *
 * ## Why `DecisionLog` is empty
 *
 * It has no rows in production, and the reason is not that the owner never
 * decides anything — it is that no surface has ever offered them the verb.
 * The queue ranks five opportunities, shows three, and gives each a button
 * that NAVIGATES to the page where the work would happen. Nothing anywhere
 * then asks whether they did it. The accuracy panel on the same page is built
 * to score committed decisions against a frozen counterfactual and has never
 * had one to score.
 *
 * ## The key has to be the raw title
 *
 * `DecisionLog` is unique on (storeId, opportunityType, opportunityTitle), and
 * `DecisionAction.title` is jargon-stripped FOR DISPLAY. Writing the stripped
 * title produces a key the generator will never match on the way back, so the
 * same opportunity would reappear next week as though nothing had been said
 * about it. `rawTitle` is the generator's own string and is what travels here.
 * The adapter carries both; this signature takes the raw one deliberately.
 *
 * ## Commit freezes, dismiss does not
 *
 * `commitDecision` freezes the current forecast alongside the row, because the
 * counterfactual that matters is the one from the moment the owner acted.
 * `dismissDecision` freezes nothing — there is no effect to measure — but it
 * does keep an optional reason, which is the only signal the ranker gets that
 * it keeps surfacing something this owner will never do.
 */
export interface DecisionRefInput {
  storeId: string
  opportunityType: OpportunityType
  /** The GENERATOR's title, not the display one. See the note above. */
  opportunityTitle: string
  opportunityAsOf: string
  predictedImpactUsdPerWeek: number
  predictedImpactP10: number | null
  predictedImpactP90: number | null
}

export async function recordDecision(
  ref: DecisionRefInput,
  outcome: "commit" | "dismiss",
  reason?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result =
    outcome === "commit"
      ? await commitDecision(ref)
      : await dismissDecision({ ...ref, reason })
  if (!result.ok) return { ok: false, error: result.error }
  return { ok: true }
}
