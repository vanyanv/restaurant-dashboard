// Per-order net-sales derivation for hourly-sync.
//
// The Otter `customer_orders` dataset returns rows with `subtotal`,
// `restaurant_funded_discount`, and `ofo_funded_discount` — but NO `net_sales`
// field (the aggregated metrics_explorer endpoint has it; the per-order
// dataset does not). Earlier versions read row.net_sales directly and got
// undefined → 0 for every row. Match the formula otter-orders-sync.ts uses
// when it persists OtterOrder rows: subtotal minus the combined funded
// discounts, treating any missing/non-numeric field as zero.

interface CustomerOrderRow {
  subtotal?: number | null
  restaurant_funded_discount?: number | null
  ofo_funded_discount?: number | null
}

const numOrZero = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0

export function computeOrderNetSales(row: CustomerOrderRow): number {
  return (
    numOrZero(row.subtotal) -
    numOrZero(row.restaurant_funded_discount) -
    numOrZero(row.ofo_funded_discount)
  )
}
