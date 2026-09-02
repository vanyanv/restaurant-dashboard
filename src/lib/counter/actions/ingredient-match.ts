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
/**
 * ## THE PRODUCT MIGHT NOT BE IN THE CATALOGUE AT ALL
 *
 * The first version of this took a `canonicalIngredientId` and nothing else,
 * so the inbox could only match a product to something already in the
 * catalogue. That is the wrong half of the problem: an unmatched invoice line
 * is unmatched precisely BECAUSE nothing recognised it, and the auto-matcher's
 * own measured accuracy on genuinely new products is about 55%. An owner
 * looking at a product this account has never bought before had a picker with
 * nothing right in it.
 *
 * `confirmSkuMatch` has always had the other branch: pass `newCanonical` and
 * it creates the ingredient, embeds it for future fuzzy matching, and then
 * writes the alias exactly as it would have. So "this is something new" is one
 * field, not a separate screen.
 *
 * The new canonical is created ONCE, on the first spelling, and every
 * remaining spelling in the cluster is then matched to that id — otherwise a
 * can liner under seven wordings would create seven ingredients, which is the
 * exact duplication the inbox exists to prevent.
 */
export async function acceptClusterMatch(input: {
  lineIds: string[]
  /** An existing ingredient, or null when `newName` names a new one. */
  canonicalIngredientId: string | null
  /** Create-and-match. Ignored when `canonicalIngredientId` is given. */
  newName?: string | null
  /** The unit the new ingredient is counted and costed in. */
  newUnit?: string | null
}): Promise<{ ok: true; backfilled: number } | { ok: false; error: string }> {
  if (input.lineIds.length === 0) return { ok: false, error: "nothing to match" }
  const wantsNew = !input.canonicalIngredientId && (input.newName ?? "").trim() !== ""
  if (!input.canonicalIngredientId && !wantsNew) {
    return { ok: false, error: "pick an ingredient, or name a new one" }
  }

  let backfilled = 0
  // Resolved after the first confirm when creating, so the rest of the cluster
  // joins the SAME new ingredient rather than making one each.
  let targetId = input.canonicalIngredientId
  try {
    for (const lineItemId of input.lineIds) {
      const result = await confirmSkuMatch(
        targetId
          ? { lineItemId, canonicalIngredientId: targetId }
          : {
              lineItemId,
              newCanonical: {
                name: (input.newName ?? "").trim(),
                defaultUnit: (input.newUnit ?? "").trim() || "each",
              },
            },
      )
      backfilled += result.backfilled
      targetId = result.canonicalIngredientId
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "match failed" }
  }
  return { ok: true, backfilled }
}
