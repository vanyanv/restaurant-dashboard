import { InvoicesChartsSlot } from "../invoices-charts-slot"
import { fetchSummary, type InvoiceFilters } from "./data"

const CATEGORY_COLORS = [
  "var(--chart-ink)",
  "var(--chart-accent)",
  "var(--chart-muted)",
  "var(--chart-subtract)",
  "var(--platform-grubhub)",
  "rgba(26, 22, 19, 0.42)",
  "rgba(220, 38, 38, 0.42)",
  "rgba(138, 58, 58, 0.36)",
]

export async function InvoiceSummaryChartsSection({
  filters,
}: {
  filters: InvoiceFilters
}) {
  const summary = await fetchSummary(
    filters.storeId,
    filters.startDate,
    filters.endDate
  )

  const categoryData = summary.spendByCategory.slice(0, 8).map((c, i) => ({
    name: c.category,
    value: c.total,
    fill: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
    percent: summary.totalSpend > 0 ? (c.total / summary.totalSpend) * 100 : 0,
  }))

  const vendorData = summary.spendByVendor.slice(0, 6).map((v) => ({
    name: v.vendor.length > 20 ? v.vendor.slice(0, 20) + "..." : v.vendor,
    fullName: v.vendor,
    spend: v.total,
  }))

  return (
    <InvoicesChartsSlot
      categoryData={categoryData}
      vendorData={vendorData}
    />
  )
}
