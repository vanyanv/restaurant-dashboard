// Sanity checks applied to OpenAI-extracted invoice data before persistence.

export const PAST_DATE_TOLERANCE_DAYS = 60
export const FUTURE_DATE_TOLERANCE_DAYS = 30

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
