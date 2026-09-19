/**
 * The commission rate a cash forecast should charge against total revenue.
 *
 * Split out of `cash-position-actions.ts` because a `"use server"` module may
 * only export async functions, and because this is the kind of figure that
 * wants a test of its own rather than a test of the action around it.
 */

/**
 * Otter platform slugs that carry a per-store commission rate.
 *
 * `css-pos` and `bnm-web` are first-party and pay none. Grubhub, Caviar and
 * anything Otter adds next have no rate column on `Store`, so they count as
 * sales with no commission rather than as an invented rate.
 */
export const COMMISSIONED_PLATFORMS = {
  ubereats: "uberCommissionRate",
  doordash: "doordashCommissionRate",
} as const

/** Trailing actuals the channel weighting is measured over. */
export const COMMISSION_MIX_DAYS = 28

/**
 * Used only when the trailing window has no sales at all — a store that has
 * not traded yet, or an account whose Otter sync has never run. A blend
 * against TOTAL revenue, which is why it is nowhere near either marketplace
 * rate on its own.
 */
export const FALLBACK_BLENDED_RATE = 0.13

export interface CommissionRateStore {
  id: string
  uberCommissionRate: number | null
  doordashCommissionRate: number | null
}

/**
 * Commission as a share of TOTAL sales, weighted by what each channel sold.
 *
 * Each store's own rate is applied to that store's own sales on that channel,
 * so a small store with a bad Uber deal cannot drag the account rate the way
 * a mean of per-store rates did. The denominator is every dollar the stores
 * took, because the numerator is charged against `predictedRevenue`, which is
 * every dollar too.
 */
export function weightedCommissionRate(
  stores: CommissionRateStore[],
  sales: { storeId: string; platform: string; net: number }[],
): number | null {
  const rateFor = new Map(stores.map((s) => [s.id, s]))
  let commission = 0
  let total = 0
  for (const row of sales) {
    if (!(row.net > 0)) continue
    total += row.net
    const store = rateFor.get(row.storeId)
    if (!store) continue
    const field = COMMISSIONED_PLATFORMS[row.platform as keyof typeof COMMISSIONED_PLATFORMS]
    if (!field) continue
    const rate = store[field]
    if (rate == null) continue
    commission += row.net * rate
  }
  return total > 0 ? commission / total : null
}
