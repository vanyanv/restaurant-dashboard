/**
 * The ONE parser for a commission rate an owner types on the store file.
 *
 * One unit end to end: the form edits PERCENTS (25 = 25%), `saveStoreFile`
 * sends percents, and `updateStore` parses them here and stores the fraction.
 * There used to be two units on the wire — the form divided by 100 and
 * `updateStore` divided anything above 1 by 100 again — so "150" saved as
 * 1.5% and "abc" in a pickup field was silently dropped. Both are now errors
 * the owner sees.
 *
 * Shared by the client (to show the error before a round trip) and the server
 * (which must not trust the client). Pure: no Prisma, no session.
 */

export type RatePercentResult =
  | { ok: true; /** Percent 0..100, or null for a cleared optional rate. */ value: number | null }
  | { ok: false; error: string }

const NUMBER = /^(\d+(\.\d*)?|\.\d+)$/

/**
 * Parse one percent field. A trailing "%" is allowed. Blank clears an
 * optional rate (null = "not known", never free) and is an error on a
 * required one. Non-numeric, negative, or above 100 is an error.
 */
export function parseRatePercent(
  raw: string,
  label: string,
  opts: { required: boolean },
): RatePercentResult {
  const s = raw.trim().replace(/%$/, "").trim()
  if (s === "") {
    return opts.required
      ? { ok: false, error: `${label}: enter a rate, as a percent` }
      : { ok: true, value: null }
  }
  if (!NUMBER.test(s)) {
    return { ok: false, error: `${label} must be a number, like 25 for 25%` }
  }
  const n = Number(s)
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    return { ok: false, error: `${label} must be between 0% and 100%` }
  }
  return { ok: true, value: n }
}

/** Percent → the fraction the `Store` columns hold. */
export function percentToFraction(pct: number): number {
  // Rounded to the hundredth of a percent the field can show, so 6.1 stores
  // as 0.061 rather than 0.060999999999999999.
  return Math.round(pct * 100) / 10000
}

/** The five rate fields: form key, the label errors use, and whether blank is allowed. */
export const COMMISSION_RATE_INPUTS = [
  { field: "doordashCommissionRate", label: "DoorDash delivery", required: true },
  { field: "doordashPickupCommissionRate", label: "DoorDash pickup", required: false },
  { field: "uberCommissionRate", label: "Uber Eats delivery", required: true },
  { field: "uberPickupCommissionRate", label: "Uber Eats pickup", required: false },
  { field: "grubhubCommissionRate", label: "Grubhub", required: false },
] as const

export type CommissionRateField = (typeof COMMISSION_RATE_INPUTS)[number]["field"]
