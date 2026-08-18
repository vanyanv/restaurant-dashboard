// Per-order net-sales derivation for hourly-sync.
//
// The Otter `customer_orders` dataset DOES return `net_sales` — it just has to
// be requested via `CUSTOMER_ORDER_COLUMNS` like any other field. Prefer it:
// it is the same basis the aggregated metrics_explorer endpoint reports as
// `fp_sales_financials_net_sales` / `third_party_net_sales`, so the hourly
// table reconciles with OtterDailySummary instead of drifting.
//
// History: an earlier version read `row.net_sales` WITHOUT listing the column,
// got undefined on every row, and replaced it with
// `subtotal − restaurant_funded_discount − ofo_funded_discount`. Otter returns
// both discount fields already NEGATIVE, so that subtraction added the discount
// back on top of the subtotal — inflating hourly net sales ~1.6× on
// discount-heavy 3P channels while leaving first-party (zero-discount) rows
// looking correct. See docs/harri-api-notes.md-style notes in git history and
// the 2026-08-18 reconciliation.
//
// The derivation below survives only as a fallback for rows where the field is
// genuinely absent, and is sign-agnostic so a future sign flip upstream cannot
// silently re-inflate the number.

interface CustomerOrderRow {
  subtotal?: number | null
  net_sales?: number | null
  restaurant_funded_discount?: number | null
  ofo_funded_discount?: number | null
}

const numOrZero = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0

export function computeOrderNetSales(row: CustomerOrderRow): number {
  if (typeof row.net_sales === "number" && Number.isFinite(row.net_sales)) {
    return row.net_sales
  }

  // Fallback: discounts reduce the subtotal regardless of the sign Otter
  // happens to send them in.
  const derived =
    numOrZero(row.subtotal) -
    Math.abs(numOrZero(row.restaurant_funded_discount)) -
    Math.abs(numOrZero(row.ofo_funded_discount))

  return derived > 0 ? derived : 0
}
