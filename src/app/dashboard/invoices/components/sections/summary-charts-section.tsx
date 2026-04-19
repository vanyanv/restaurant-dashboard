import { InvoicesChartsSlot } from "../invoices-charts-slot"
import { fetchSummary } from "./data"

const CATEGORY_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "hsl(var(--primary) / 0.6)",
  "hsl(var(--primary) / 0.4)",
  "hsl(var(--primary) / 0.25)",
]

export async function InvoiceSummaryChartsSection({
  storeId,
}: {
  storeId?: string
}) {
  const summary = await fetchSummary(storeId)

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
