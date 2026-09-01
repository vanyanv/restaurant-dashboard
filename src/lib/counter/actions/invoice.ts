"use server"

import {
  setInvoiceIsReturn,
  setInvoiceReviewDecision,
} from "@/app/actions/invoice-actions"

/**
 * The Counter layer's write path for one invoice — same shape as
 * `./store.ts`, `./recipe.ts`, `./stock-count.ts` and `./settings.ts`: a
 * `"use server"` module that the page client may import, wrapping the
 * `@/app/actions/*` module that it may not.
 *
 * Two decisions live here because they are the two things an owner can say
 * about an invoice they are looking at:
 *
 *   - **Is this document good?** — `resolveInvoiceReview`, which drains the
 *     REVIEW queue. See `setInvoiceReviewDecision` for what APPROVED and
 *     REJECTED mean and, more importantly, for what they deliberately do NOT
 *     do to the figures.
 *   - **Is this a credit rather than a bill?** — `markInvoiceReturn`, which
 *     flips the sign of the whole document. This one DOES rewrite the line
 *     items, and it is idempotent by construction.
 *
 * Both return the plain `{ ok }` union the Counter clients already branch on,
 * so neither leaks a Prisma type or a server-action import into the bundle.
 */
export async function resolveInvoiceReview(
  invoiceId: string,
  decision: "APPROVED" | "REJECTED" | "REVIEW",
): Promise<{ ok: true; status: string } | { ok: false; error: string }> {
  const result = await setInvoiceReviewDecision(invoiceId, decision)
  if (!result.ok) return { ok: false, error: result.reason }
  return { ok: true, status: result.status }
}

export async function markInvoiceReturn(
  invoiceId: string,
  isReturn: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await setInvoiceIsReturn(invoiceId, isReturn)
  if (!result.ok) return { ok: false, error: result.reason }
  return { ok: true }
}
