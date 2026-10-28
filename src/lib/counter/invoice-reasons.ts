import { titleCase } from "@/lib/counter/format"

/**
 * The words for a `ReviewReason.kind` (`src/lib/invoice-sanity.ts`), in one
 * place so the Needs you queue and the invoice page name a reason the same way.
 */
export const REASON_LABEL: Record<string, string> = {
  no_lines: "Nothing was extracted",
  total_reconciliation: "The lines do not sum to the subtotal",
  line_math: "A line's arithmetic does not hold",
  pack_shape: "A pack shape looks wrong",
  date_suspect: "The printed date is implausible",
  low_match_confidence: "The store match is uncertain",
  no_store_match: "No store matched the address",
  not_a_supplier: "Not a supply delivery",
  not_an_invoice: "Not an invoice",
  unknown: "Flagged",
}

export function reasonLabel(kind: string): string {
  return REASON_LABEL[kind] ?? titleCase(kind.replace(/_/g, " "))
}
