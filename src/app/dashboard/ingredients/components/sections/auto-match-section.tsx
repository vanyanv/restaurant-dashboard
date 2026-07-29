import { listRecentAutoMatches } from "@/app/actions/ingredient-auto-match-actions"
import { AutoMatchActivity } from "../auto-match-activity"

const WINDOW_DAYS = 7

/**
 * Server section for the auto-match activity strip. SHADOW rows are kept
 * (the default) — during a shadow rollout they are the entire point of the
 * surface, and the strip labels them as proposals rather than links.
 *
 * Renders nothing when there is no recent activity, which is the normal
 * state while `INGREDIENT_AUTO_MATCH` is off.
 */
export async function AutoMatchSection() {
  const decisions = await listRecentAutoMatches(WINDOW_DAYS)
  return <AutoMatchActivity decisions={decisions} days={WINDOW_DAYS} />
}
