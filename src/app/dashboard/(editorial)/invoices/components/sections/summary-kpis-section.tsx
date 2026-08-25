import { formatCurrency } from "@/lib/format"
import { fetchSummary, type InvoiceFilters } from "./data"

interface KpiRow {
  folio: string
  label: string
  value: string
  sub: string
  alert?: boolean
}

export async function InvoiceSummaryKpisSection({
  filters,
}: {
  filters: InvoiceFilters
}) {
  const summary = await fetchSummary(
    filters.storeId,
    filters.startDate,
    filters.endDate
  )

  const kpis: KpiRow[] = [
    {
      folio: "Fig. 01",
      label: "Invoices received",
      value: summary.invoiceCount.toLocaleString(),
      sub: "this period",
    },
    {
      folio: "Fig. 02",
      label: "Average invoice",
      value: formatCurrency(summary.avgInvoiceTotal),
      sub: "per delivery",
    },
    {
      folio: "Fig. 03",
      label: "Suppliers",
      value: summary.vendorCount.toLocaleString(),
      sub: "unique vendors",
    },
    {
      folio: "Fig. 04",
      label: "Needs review",
      value: summary.pendingReviewCount.toLocaleString(),
      sub: "flagged invoices",
      alert: summary.pendingReviewCount > 0,
    },
  ]

  return (
    <div className="inv-kpis">
      {kpis.map((kpi, i) => (
        <div
          key={kpi.label}
          className={`inv-kpi dock-in dock-in-${i + 1}${kpi.alert ? " inv-kpi--alert" : ""}`}
        >
          <span className="inv-kpi__folio">{kpi.folio}</span>
          <span className="inv-kpi__label">{kpi.label}</span>
          <span className="inv-kpi__value">{kpi.value}</span>
          <span className="inv-kpi__sub">{kpi.sub}</span>
        </div>
      ))}
    </div>
  )
}
