// How the sync decides whether an invoice is VERIFIED, and which of its lines
// may set an ingredient's price. Pure — no Prisma — so the sync route, the
// re-verify script and the tests read one rule.
//
// The owner's instruction (2026-11-03): nothing should come to review when
// invoices arrive; every figure double-checked, accurate, never invented. So
// the sync resolves an invoice itself whenever the document proves it, and
// when it cannot, the invoice is held AND its prices are kept out of recipe
// costs. A held invoice never quietly sets a price.
//
// What proves an invoice:
//   - the goods lines tie to the printed subtotal (or total less tax) within
//     `TIE_OUT_TOLERANCE` — the document's own arithmetic, after the PDF
//     re-read the sync already does when it does not;
//   - a printed date that is plausible next to the email's arrival;
//   - a store, matched by address (see `matchInvoiceToStore`, which now
//     verifies a near-miss by street number + ZIP rather than asking).
//
// What does NOT stop an invoice being verified, because the total already
// proves the money: one line whose quantity × price does not equal its
// printed amount, or whose pack shape cannot be checked against the SKU's
// history. Those lines are recorded on the invoice (`lineNumbers`) and are
// never used to price an ingredient — the line's amount counts toward spend,
// its per-unit price is not trusted. See `isLinePriceable`.

import type { InvoiceExtraction } from "@/types/invoice"
import {
  composeReviewReasons,
  findEmptyExtraction,
  findLineMathMismatches,
  findPackShapeAnomalies,
  findTotalReconciliationMismatch,
  type ReviewReason,
} from "@/lib/invoice-sanity"

/** Store auto-match confidence at or above which the store is verified. */
export const STORE_MATCH_VERIFIED = 0.85

/**
 * The invoice statuses whose lines may price an ingredient. MATCHED is the
 * sync's verified state; APPROVED is the owner's. REVIEW, PENDING (no store)
 * and REJECTED never set a price.
 */
export const PRICED_INVOICE_STATUSES = ["MATCHED", "APPROVED"] as const
export type PricedInvoiceStatus = (typeof PRICED_INVOICE_STATUSES)[number]

/**
 * Reason kinds that describe ONE LINE of an otherwise verified invoice. On a
 * MATCHED invoice they mark lines whose price is not used; anywhere else they
 * are reasons like any other.
 */
export const LINE_NOTE_KINDS: ReadonlySet<string> = new Set(["line_math", "pack_shape"])

type Line = InvoiceExtraction["lineItems"][number]

export interface VerifyInput {
  extraction: Pick<InvoiceExtraction, "lineItems" | "subtotal" | "taxAmount" | "totalAmount">
  /** The printed date was read and rejected as implausible. */
  dateSuspect: boolean
  /** The store match, or null when no store matched the address. */
  match: { confidence: number } | null
  /** Lines whose pack shape matches this SKU's accepted history. */
  isPackConfirmed?: (line: Line) => boolean
}

export interface VerifyResult {
  status: "MATCHED" | "REVIEW" | "PENDING"
  reviewReasons: ReviewReason[]
  /** Line numbers whose per-unit price must not be used. */
  unpricedLines: number[]
}

const fmt = (n: number) =>
  `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * Decide an invoice's status from what its document proves.
 *
 * REVIEW now means one thing: the invoice's own money or date could not be
 * verified even after a second read (no lines, lines that do not tie to the
 * printed total, a printed date that cannot be right), or the store could not
 * be proved from the address. Nothing is guessed to get past any of those.
 */
export function verifyInvoice(input: VerifyInput): VerifyResult {
  const { extraction } = input
  const mathMismatches = findLineMathMismatches(extraction.lineItems)
  const packAnomalies = findPackShapeAnomalies(extraction.lineItems, {
    isConfirmed: input.isPackConfirmed,
  })
  const totalMismatch = findTotalReconciliationMismatch(extraction)
  const emptyExtraction = findEmptyExtraction(extraction)

  const unpricedLines = [
    ...new Set([
      ...mathMismatches.map((m) => m.lineNumber),
      ...packAnomalies.map((a) => a.lineNumber),
    ]),
  ].sort((a, b) => a - b)

  // No printed total read at all: nothing proves the money, so it is held.
  const totalAmount = Number(extraction.totalAmount)
  const totalMissing = extraction.totalAmount == null || !Number.isFinite(totalAmount)

  // The money or the date is not proved: held, every reason recorded.
  if (input.dateSuspect || totalMismatch || emptyExtraction || totalMissing) {
    return {
      status: "REVIEW",
      reviewReasons: [
        ...(totalMissing
          ? [
              {
                kind: "total_reconciliation" as const,
                message:
                  "The invoice's printed total could not be read, so its lines can't be checked against it. " +
                  "Compare the line list against the PDF before approving.",
              },
            ]
          : []),
        ...composeReviewReasons({
        dateSuspect: input.dateSuspect,
        mathMismatches,
        packAnomalies,
        totalMismatch,
        emptyExtraction,
        matchConfidence: input.match?.confidence ?? null,
        matched: Boolean(input.match),
        }),
      ],
      unpricedLines,
    }
  }

  // The total proves the money. Lines that cannot price an ingredient are
  // noted, and say so in words.
  const lineNotes: ReviewReason[] = [
    ...mathMismatches.map((m) => ({
      kind: "line_math" as const,
      message:
        `Line ${m.lineNumber} "${m.productName}": ${m.quantity} ${m.unit ?? "×"} at ${fmt(m.unitPrice)} ` +
        `computes to ${fmt(m.computed)}, but the invoice prints ${fmt(m.extendedPrice)}. The invoice ` +
        "still ties to its printed total, so its spend is verified; this line's per-unit price is not " +
        "used for any recipe cost.",
      lineNumbers: [m.lineNumber],
    })),
    ...packAnomalies.map((a) => ({
      kind: "pack_shape" as const,
      message:
        `Line ${a.lineNumber} "${a.productName}": the pack shape could not be verified ` +
        `(${a.reasons.join("; ")}). The invoice ties to its printed total, so its spend is verified; ` +
        "this line's per-unit price is not used for any recipe cost.",
      lineNumbers: [a.lineNumber],
    })),
  ]

  if (!input.match) {
    return { status: "PENDING", reviewReasons: lineNotes, unpricedLines }
  }

  if (input.match.confidence < STORE_MATCH_VERIFIED) {
    return {
      status: "REVIEW",
      reviewReasons: [
        ...lineNotes,
        {
          kind: "low_match_confidence",
          message:
            `The delivery address matches a store at only ${(input.match.confidence * 100).toFixed(0)}% ` +
            "and could not be proved by street number and ZIP — confirm the store.",
        },
      ],
      unpricedLines,
    }
  }

  return { status: "MATCHED", reviewReasons: lineNotes, unpricedLines }
}

/** Line numbers a stored `reviewReasons` value marks as not to be priced. */
export function unpricedLineNumbers(reviewReasons: unknown): Set<number> {
  const out = new Set<number>()
  if (!Array.isArray(reviewReasons)) return out
  for (const r of reviewReasons) {
    if (!r || typeof r !== "object") continue
    const kind = (r as { kind?: unknown }).kind
    const lines = (r as { lineNumbers?: unknown }).lineNumbers
    if (typeof kind !== "string" || !LINE_NOTE_KINDS.has(kind) || !Array.isArray(lines)) continue
    for (const n of lines) if (typeof n === "number") out.add(n)
  }
  return out
}

/**
 * May this invoice line set an ingredient's price?
 *
 * Only a line on a verified invoice (MATCHED or APPROVED), and on a MATCHED
 * invoice only when the sync did not mark the line itself as unverifiable.
 * An APPROVED invoice is the owner's own check of the whole document, line
 * notes included, so its lines all count.
 */
export function isLinePriceable(
  invoice: { status: string; reviewReasons?: unknown },
  lineNumber: number,
): boolean {
  if (!(PRICED_INVOICE_STATUSES as readonly string[]).includes(invoice.status)) return false
  if (invoice.status === "APPROVED") return true
  return !unpricedLineNumbers(invoice.reviewReasons).has(lineNumber)
}
