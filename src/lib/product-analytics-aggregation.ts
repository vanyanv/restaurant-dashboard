/**
 * Pure shaper for the SQL-aggregated top-products result.
 *
 * The action used to fetch every InvoiceLineItem (10k–100k rows) and group in
 * JS. We now do `GROUP BY productName` in Postgres and only ship the top-N to
 * JS; this helper sorts (defensively) and caps the list.
 */

import type { ProductAnalyticsItem } from "@/types/invoice"

export type RawProductAggregateRow = {
  productName: string
  sku: string | null
  category: string | null
  unit: string | null
  totalQuantity: number
  totalSpend: number
  avgUnitPrice: number
  invoiceCount: number | bigint
}

export function shapeTopProducts(
  rows: RawProductAggregateRow[],
  limit: number
): ProductAnalyticsItem[] {
  return [...rows]
    .sort((a, b) => b.totalSpend - a.totalSpend)
    .slice(0, limit)
    .map((r) => ({
      productName: r.productName,
      sku: r.sku,
      category: r.category,
      unit: r.unit,
      totalQuantity: Number(r.totalQuantity),
      totalSpend: Number(r.totalSpend),
      avgUnitPrice: Number(r.avgUnitPrice),
      invoiceCount: Number(r.invoiceCount),
    }))
}
