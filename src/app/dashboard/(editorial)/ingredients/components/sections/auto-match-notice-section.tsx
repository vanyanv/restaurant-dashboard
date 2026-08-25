import { listRecentAutoMatches } from "@/app/actions/ingredient-auto-match-actions"
import { AutoMatchNotice } from "../auto-match-notice"

const WINDOW_DAYS = 7

/**
 * Server section for the owner-facing auto-match notice.
 *
 * `excludeShadow: true` is the whole difference from the audit page's log: a
 * SHADOW decision changed nothing, so it has nothing to say to an owner. While
 * `INGREDIENT_AUTO_MATCH` is in shadow — prod's current mode — this renders
 * nothing and the ledger starts at the top of the page.
 */
export async function AutoMatchNoticeSection() {
  const decisions = await listRecentAutoMatches(WINDOW_DAYS, { excludeShadow: true })
  return <AutoMatchNotice decisions={decisions} days={WINDOW_DAYS} />
}
