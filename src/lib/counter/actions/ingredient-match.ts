"use server"

import { confirmSkuMatch } from "@/app/actions/ingredient-match-actions"

/**
 * ACCEPTING A CLUSTER FROM THE REVIEW INBOX.
 *
 * `counter-ingredients-client.tsx` carried this note beside the inbox's two
 * buttons: "This application has neither action: nothing in the tree accepts
 * or rejects a cluster, so both were rewritten as links… this section needs
 * accept/reject actions, and until it has them its second control cannot be
 * honest." It named the defect precisely and left the route open. This is the
 * accept half.
 *
 * The claim that nothing could accept was not right. `confirmSkuMatch` has
 * been in `@/app/actions/ingredient-match-actions` the whole time, the
 * editorial match-picker sheet called it, and its shape is exactly what a
 * cluster needs: give it one `InvoiceLineItem` and a canonical, and it writes
 * the alias from that line's (vendor, sku, productName) and BACKFILLS every
 * other line matching the same spelling.
 *
 * ## WHY THIS TAKES A LIST OF IDS
 *
 * A cluster is a PRODUCT, and a product arrives under several spellings —
 * seven of this account's are one can liner under seven wordings of it. The
 * alias is learned per spelling, so accepting the cluster means confirming
 * each one. The adapter hands over one line id per spelling and this walks
 * them, returning the total backfilled so the page can say what actually
 * moved rather than "done".
 *
 * Serially, not `Promise.all`: they write aliases against the same canonical
 * and the same vendor rows, and a cluster is at most a handful of spellings.
 * Racing them buys milliseconds and risks two writers deriving the canonical's
 * cost from half-applied state.
 *
 * ## THERE IS NO REJECT, AND THE PAGE SAYS SO
 *
 * The prototype's second button is "Not this", which rejects a SUGGESTION.
 * Nothing suggests anything here — auto-match runs in shadow mode and the page
 * offers the whole catalogue precisely because a single guess would be wrong
 * about half the time on new products. With no suggestion there is nothing to
 * reject, so the second control stays a link to the invoice the line came
 * from, which is where someone goes to decide what the thing actually is.
 */
export async function acceptClusterMatch(input: {
  lineIds: string[]
  canonicalIngredientId: string
}): Promise<{ ok: true; backfilled: number } | { ok: false; error: string }> {
  if (input.lineIds.length === 0) return { ok: false, error: "nothing to match" }
  let backfilled = 0
  try {
    for (const lineItemId of input.lineIds) {
      const result = await confirmSkuMatch({
        lineItemId,
        canonicalIngredientId: input.canonicalIngredientId,
      })
      backfilled += result.backfilled
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "match failed" }
  }
  return { ok: true, backfilled }
}
