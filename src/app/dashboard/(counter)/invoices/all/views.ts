import type { InvoiceListRow } from "@/lib/counter/adapters/invoices"

/**
 * The list's views, one chip each. Shared by the page (which reads `?view=`
 * from a tile on Needs you) and the client (which draws the chips).
 *
 * The three worklist views — Needs you, Does not add up, In review — count
 * every date, the way the Needs you queue and the "In review" tile do: a
 * figure that names a problem has to reach every invoice it counts. Every
 * other view is the trailing window the list is captioned with.
 */
export const VIEWS = ["all", "needs", "gaps", "review", "approved", "matched", "rejected", "credits"] as const
export type View = (typeof VIEWS)[number]

export function isView(v: string | null): v is View {
  return v !== null && (VIEWS as readonly string[]).includes(v)
}

export const VIEW_LABEL: Record<View, string> = {
  all: "All",
  needs: "Needs you",
  gaps: "Does not add up",
  review: "In review",
  approved: "Approved",
  matched: "Matched",
  rejected: "Rejected",
  credits: "Credits",
}

export function inView(r: InvoiceListRow, v: View): boolean {
  if (v === "gaps") return r.gap !== null
  if (v === "needs") return r.needsYou
  if (v === "review") return r.status === "REVIEW"
  if (!r.inWindow) return false
  switch (v) {
    case "all":
      return true
    case "approved":
      return r.status === "APPROVED"
    case "matched":
      return r.status === "MATCHED"
    case "rejected":
      return r.status === "REJECTED"
    case "credits":
      return r.isReturn
    default:
      return false
  }
}
