// Sanity checks applied to OpenAI-extracted invoice data before persistence.

import type { InvoiceExtraction } from "@/types/invoice"

export const PAST_DATE_TOLERANCE_DAYS = 60
export const FUTURE_DATE_TOLERANCE_DAYS = 30

// Maximum allowed relative drift between quantity*unitPrice and extendedPrice
// before a line is considered arithmetically inconsistent. 2% covers normal
// rounding (per-lb decimals, sub-cent unit prices) without masking real misreads
// like Premier Meats #2232461 where quantity captured cases instead of pounds
// and the implied math was off by ~60×.
export const LINE_MATH_TOLERANCE = 0.02

/**
 * Returns the extracted invoiceDate as a Date, or null if it's obviously wrong.
 *
 * gpt-4o occasionally hallucinates years when an invoice template is unusual
 * (e.g. Premier Meats "CoPilot Invoices" returning 2023; Sysco returning 1926).
 * We compare against the email's receivedAt: if the gap is more than
 * PAST_DATE_TOLERANCE_DAYS in the past or FUTURE_DATE_TOLERANCE_DAYS in the
 * future, we treat the extracted date as unreliable and drop it, letting the
 * caller flag the row for manual REVIEW.
 */
export function sanitizeInvoiceDate(
  extracted: string | null,
  emailReceivedAt: Date | null,
  context: string
): Date | null {
  if (!extracted) return null
  const parsed = new Date(extracted)
  if (Number.isNaN(parsed.getTime())) return null
  if (!emailReceivedAt) return parsed

  const diffDays = (parsed.getTime() - emailReceivedAt.getTime()) / (1000 * 60 * 60 * 24)
  if (diffDays < -PAST_DATE_TOLERANCE_DAYS || diffDays > FUTURE_DATE_TOLERANCE_DAYS) {
    console.warn(
      `Invoice date out of range (${extracted}, email ${emailReceivedAt.toISOString().slice(0, 10)}, diff ${diffDays.toFixed(0)}d) — nulling for ${context}`
    )
    return null
  }
  return parsed
}

export interface LineMathMismatch {
  lineNumber: number
  productName: string
  quantity: number
  unit: string | null
  unitPrice: number
  extendedPrice: number
  /** quantity * unitPrice (what we'd expect extendedPrice to equal). */
  computed: number
  /** extendedPrice / unitPrice — quantity the model probably should have set. */
  impliedQuantity: number | null
}

/**
 * Identify line items whose `quantity * unitPrice` diverges from the printed
 * `extendedPrice` by more than LINE_MATH_TOLERANCE. The most common cause is
 * the model assigning quantity to the wrong column (e.g. "8 cases" instead of
 * "487.52 lb" for catch-weight meat). Lines with a missing unitPrice, missing
 * extendedPrice, or extendedPrice of 0 are skipped because the relative drift
 * isn't meaningful there.
 */
export function findLineMathMismatches(
  lineItems: InvoiceExtraction["lineItems"]
): LineMathMismatch[] {
  const mismatches: LineMathMismatch[] = []
  for (const li of lineItems) {
    const qty = Number(li.quantity)
    const unitPrice = Number(li.unitPrice)
    const ext = Number(li.extendedPrice)
    if (!Number.isFinite(qty) || !Number.isFinite(unitPrice) || !Number.isFinite(ext)) continue
    if (Math.abs(ext) < 0.01) continue
    const computed = qty * unitPrice
    const drift = Math.abs(computed - ext) / Math.abs(ext)
    if (drift <= LINE_MATH_TOLERANCE) continue
    mismatches.push({
      lineNumber: li.lineNumber,
      productName: li.productName,
      quantity: qty,
      unit: li.unit,
      unitPrice,
      extendedPrice: ext,
      computed,
      impliedQuantity: unitPrice > 0 ? ext / unitPrice : null,
    })
  }
  return mismatches
}
