import { DollarSign, FileText, AlertCircle, TrendingUp } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { formatCurrency } from "@/lib/format"
import { fetchSummary } from "./data"

const KPI_STYLES = [
  {
    title: "Total Spend",
    icon: DollarSign,
    borderColor: "hsl(221, 83%, 53%)",
    bgTint: "hsla(221, 83%, 53%, 0.04)",
  },
  {
    title: "Invoices",
    icon: FileText,
    borderColor: "hsl(142, 71%, 45%)",
    bgTint: "hsla(142, 71%, 45%, 0.04)",
  },
  {
    title: "Avg Invoice",
    icon: TrendingUp,
    borderColor: "hsl(262, 83%, 58%)",
    bgTint: "hsla(262, 83%, 58%, 0.04)",
  },
  {
    title: "Needs Review",
    icon: AlertCircle,
    borderColor: "hsl(35, 85%, 45%)",
    bgTint: "hsla(35, 85%, 45%, 0.04)",
  },
]

export async function InvoiceSummaryKpisSection({
  storeId,
}: {
  storeId?: string
}) {
  const summary = await fetchSummary(storeId)
  const values = [
    formatCurrency(summary.totalSpend),
    summary.invoiceCount.toString(),
    formatCurrency(summary.avgInvoiceTotal),
    summary.pendingReviewCount.toString(),
  ]

  return (
    <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
      {KPI_STYLES.map((kpi, i) => (
        <div
          key={kpi.title}
          className={`dock-in dock-in-${(i % 4) + 1}`}
        >
          <Card
            className="relative overflow-hidden border-t-[3px] py-3"
            style={{
              borderTopColor: kpi.borderColor,
              backgroundColor: kpi.bgTint,
            }}
          >
            <CardContent className="p-3">
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {kpi.title}
              </span>
              <div className="mt-1 tabular-nums text-xl font-bold tracking-tight sm:text-2xl">
                {values[i]}
              </div>
            </CardContent>
          </Card>
        </div>
      ))}
    </div>
  )
}
