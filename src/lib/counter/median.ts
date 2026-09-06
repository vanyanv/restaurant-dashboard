/**
 * The middle value, or the mean of the two middle values.
 *
 * This is the one function that owns median for the counter layer — a figure
 * shown on more than one page comes from here, not from a per-adapter copy.
 * `prices.ts` used to keep its own copy that returned the upper-middle
 * element on an even-length population (`sorted[Math.floor(n / 2)]`), which
 * is not a median; `alerts.ts` had the correct arithmetic already, so this
 * module is that body promoted out, and alerts now re-exports from here.
 *
 * Returns null for an empty population rather than 0 — nothing measured is
 * not "measures as zero".
 */
export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}
