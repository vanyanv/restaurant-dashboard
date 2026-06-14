/**
 * Single-pass channel rollup for `getOtterAnalytics` / `getDashboardAnalytics`.
 *
 * The previous implementation built a `Set<channelKey>` from the daily summaries
 * then ran ~13 `summaries.filter(...)` passes per channel — quadratic-ish on
 * 60-day, all-stores windows. This reducer walks the rows once and accumulates
 * every metric in a single Map.
 *
 * Channel keying:
 *   - FP platforms (css-pos, bnm-web): keyed by (platform, paymentMethod).
 *     Payment method `"N/A"` collapses to null.
 *   - 3P platforms: keyed by platform only; paymentMethod is null.
 */

export type ChannelSummaryRow = {
  platform: string
  paymentMethod: string | null
  fpGrossSales: number | null
  fpNetSales: number | null
  fpFees: number | null
  fpDiscounts: number | null
  fpTaxCollected: number | null
  fpTaxRemitted: number | null
  fpTips: number | null
  fpServiceCharges: number | null
  fpLoyalty: number | null
  fpOrderCount: number | null
  tpGrossSales: number | null
  tpNetSales: number | null
  tpFees: number | null
  tpDiscounts: number | null
  tpTaxCollected: number | null
  tpTaxRemitted: number | null
  tpTipForRestaurant: number | null
  tpServiceCharges: number | null
  tpLoyaltyDiscount: number | null
  tpRefundsAdjustments: number | null
  tpOrderCount: number | null
  tillPaidIn: number | null
  tillPaidOut: number | null
}

export type ChannelTotals = {
  platform: string
  paymentMethod: string | null
  grossSales: number
  netSales: number
  fees: number
  discounts: number
  taxCollected: number
  taxRemitted: number
  tips: number
  serviceCharges: number
  loyalty: number
  refundsAdjustments: number
  orderCount: number
  paidIn: number
  paidOut: number
  theoreticalDeposit: number
  expectedDeposit: number
}

const FP_PLATFORMS = new Set(["css-pos", "bnm-web"])

function isFP(platform: string): boolean {
  return FP_PLATFORMS.has(platform)
}

function emptyTotals(platform: string, paymentMethod: string | null): ChannelTotals {
  return {
    platform,
    paymentMethod,
    grossSales: 0,
    netSales: 0,
    fees: 0,
    discounts: 0,
    taxCollected: 0,
    taxRemitted: 0,
    tips: 0,
    serviceCharges: 0,
    loyalty: 0,
    refundsAdjustments: 0,
    orderCount: 0,
    paidIn: 0,
    paidOut: 0,
    theoreticalDeposit: 0,
    expectedDeposit: 0,
  }
}

export function aggregateChannelTotals(
  rows: ChannelSummaryRow[]
): Map<string, ChannelTotals> {
  const out = new Map<string, ChannelTotals>()

  for (const r of rows) {
    const fp = isFP(r.platform)
    const pm = fp && r.paymentMethod && r.paymentMethod !== "N/A" ? r.paymentMethod : null
    const key = `${r.platform}|||${pm ?? ""}`

    let entry = out.get(key)
    if (!entry) {
      entry = emptyTotals(r.platform, pm)
      out.set(key, entry)
    }

    if (fp) {
      entry.grossSales += r.fpGrossSales ?? 0
      entry.netSales += r.fpNetSales ?? 0
      entry.fees += r.fpFees ?? 0
      entry.discounts += r.fpDiscounts ?? 0
      entry.taxCollected += r.fpTaxCollected ?? 0
      entry.taxRemitted += r.fpTaxRemitted ?? 0
      entry.tips += r.fpTips ?? 0
      entry.serviceCharges += r.fpServiceCharges ?? 0
      entry.loyalty += r.fpLoyalty ?? 0
      entry.orderCount += r.fpOrderCount ?? 0
    } else {
      entry.grossSales += r.tpGrossSales ?? 0
      entry.netSales += r.tpNetSales ?? 0
      entry.fees += r.tpFees ?? 0
      entry.discounts += r.tpDiscounts ?? 0
      entry.taxCollected += r.tpTaxCollected ?? 0
      entry.taxRemitted += r.tpTaxRemitted ?? 0
      entry.tips += r.tpTipForRestaurant ?? 0
      entry.serviceCharges += r.tpServiceCharges ?? 0
      entry.loyalty += r.tpLoyaltyDiscount ?? 0
      entry.refundsAdjustments += r.tpRefundsAdjustments ?? 0
      entry.orderCount += r.tpOrderCount ?? 0
    }
    entry.paidIn += r.tillPaidIn ?? 0
    entry.paidOut += r.tillPaidOut ?? 0
  }

  for (const entry of out.values()) {
    entry.theoreticalDeposit =
      entry.netSales +
      entry.taxCollected -
      Math.abs(entry.taxRemitted) +
      entry.tips +
      entry.serviceCharges -
      Math.abs(entry.fees)
    entry.expectedDeposit =
      entry.theoreticalDeposit + entry.paidIn - Math.abs(entry.paidOut)
  }

  return out
}
