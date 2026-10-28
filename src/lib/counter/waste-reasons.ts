import type { InventoryAdjustmentReason } from "@/generated/prisma/enums"

/**
 * THE ONE REASON TAXONOMY FOR STOCK THAT LEFT THE SHELF UNSOLD.
 *
 * `InventoryAdjustment.reason` is one Postgres enum, and two forms wrote to it
 * with two vocabularies: Inventory's "Adjust on hand" offered EXPIRY / DAMAGE
 * / THEFT / SUPPLIER_RETURN / OTHER and labelled EXPIRY "Expired"; the Count &
 * waste log offered DROPPED / EXPIRY / BURNT / REMAKE / OTHER and labelled the
 * same EXPIRY "Went bad". The count report then summed every reason into each
 * row's "waste" column — theft and supplier returns included — while its
 * "Waste $" total counted only the log's five, so the rows did not add up to
 * the figure above them.
 *
 * Every reason now has one label and one CLASS, and every page that values an
 * adjustment groups by class:
 *
 *   - **waste**  — food that was spoiled or ruined: dropped, went bad, burnt,
 *     remade, damaged.
 *   - **shrink** — food that left without being used: theft.
 *   - **return** — food that went back to the vendor: a supplier return. It
 *     left the shelf but it is not a loss; the credit arrives on an invoice.
 *   - **other**  — the operator said "other", and we do not guess.
 *
 * The stored enum values are unchanged — this is labels and grouping, not a
 * migration. It is a client-safe module (no Prisma runtime), because both
 * forms import it.
 */

export type ReasonClass = "waste" | "shrink" | "return" | "other"

export interface AdjustmentReasonInfo {
  id: InventoryAdjustmentReason
  label: string
  class: ReasonClass
}

/** Every reason the schema stores, in the order a form lists them. */
export const ADJUSTMENT_REASONS = [
  { id: "DROPPED", label: "Dropped", class: "waste" },
  { id: "EXPIRY", label: "Went bad", class: "waste" },
  { id: "BURNT", label: "Burnt", class: "waste" },
  { id: "REMAKE", label: "Remake", class: "waste" },
  { id: "DAMAGE", label: "Damaged", class: "waste" },
  { id: "THEFT", label: "Theft", class: "shrink" },
  // "Sent back": nobody standing in a walk-in calls it a supplier return.
  { id: "SUPPLIER_RETURN", label: "Sent back", class: "return" },
  { id: "OTHER", label: "Other", class: "other" },
] as const satisfies readonly AdjustmentReasonInfo[]

export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number]["id"]

/** The words a class is printed as. */
export const REASON_CLASS_LABEL: Record<ReasonClass, string> = {
  waste: "Waste",
  shrink: "Theft",
  return: "Sent back",
  other: "Other",
}

export function reasonInfo(id: string): AdjustmentReasonInfo | undefined {
  return ADJUSTMENT_REASONS.find((r) => r.id === id)
}

export function reasonLabel(id: string): string {
  return reasonInfo(id)?.label ?? id.charAt(0) + id.slice(1).toLowerCase().replace(/_/g, " ")
}

/** An unknown reason is `other` — never silently waste. */
export function reasonClass(id: string): ReasonClass {
  return reasonInfo(id)?.class ?? "other"
}

/**
 * The reasons a form offers, by id, in taxonomy order — so the two forms
 * carry the same labels for the reasons they share.
 */
function pick<const T extends readonly AdjustmentReason[]>(ids: T) {
  return ADJUSTMENT_REASONS.filter((r) => (ids as readonly string[]).includes(r.id)) as Array<
    Extract<(typeof ADJUSTMENT_REASONS)[number], { id: T[number] }>
  >
}

/** The Count & waste log's quick-pick: kitchen waste, plus Other. */
export const WASTE_LOG_REASONS = pick(["DROPPED", "EXPIRY", "BURNT", "REMAKE", "OTHER"] as const)

/** Inventory's "Adjust on hand": stock that left for a reason other than the line. */
export const ADJUST_FORM_REASONS = pick([
  "EXPIRY",
  "DAMAGE",
  "THEFT",
  "SUPPLIER_RETURN",
  "OTHER",
] as const)

export type AdjustFormReason = (typeof ADJUST_FORM_REASONS)[number]["id"]

/** One adjustment, valued: `qty` in recipe units × `cost` per recipe unit. */
export interface ValuedAdjustment {
  reason: string
  qty: number
  /** Cost per recipe unit; null values the entry at zero dollars. */
  cost: number | null
}

export interface AdjustmentTotals {
  /** Dollars by class. */
  dollars: Record<ReasonClass, number>
  /** Recipe-unit quantity by class. */
  qty: Record<ReasonClass, number>
  /** Entries by class. */
  entries: Record<ReasonClass, number>
}

const zero = (): Record<ReasonClass, number> => ({ waste: 0, shrink: 0, return: 0, other: 0 })

/**
 * The one sum every page that prints a waste, theft or returns figure reads.
 * A row total and a page total built from this cannot disagree about which
 * reason counts as which.
 */
export function sumAdjustments(entries: Iterable<ValuedAdjustment>): AdjustmentTotals {
  const out: AdjustmentTotals = { dollars: zero(), qty: zero(), entries: zero() }
  for (const e of entries) {
    const c = reasonClass(e.reason)
    out.qty[c] += e.qty
    out.dollars[c] += e.qty * (e.cost ?? 0)
    out.entries[c] += 1
  }
  return out
}
