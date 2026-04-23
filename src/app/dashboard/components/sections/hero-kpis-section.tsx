import { HeroKpi, formatMoneyLarge, formatUsd } from "../hero-kpi"
import type { DashboardRange } from "@/lib/dashboard-utils"
import { fetchInvoiceSpend30d, fetchOtter } from "./data"

export async function HeroKpisSection({ range }: { range: DashboardRange }) {
  const [otter, invoiceSpend30d] = await Promise.all([
    fetchOtter(range),
    fetchInvoiceSpend30d(),
  ])

  const kpis = otter
    ? {
        gross: otter.kpis.grossRevenue,
        net: otter.kpis.netRevenue,
        orders: otter.kpis.totalOrders,
        avg: otter.kpis.averageOrderValue,
      }
    : null

  const invoiceSpend = invoiceSpend30d?.total ?? 0

  return (
    <dl className="editorial-kpi-strip editorial-kpi-strip-wide dock-in dock-in-2">
      <HeroKpi
        label="Gross sales"
        value={kpis ? formatMoneyLarge(kpis.gross) : "—"}
        unit="USD"
        delta={null}
      />
      <HeroKpi
        label="Net sales"
        value={kpis ? formatMoneyLarge(kpis.net) : "—"}
        unit="USD"
        delta={null}
      />
      <HeroKpi
        label="Orders"
        value={kpis ? kpis.orders.toLocaleString() : "—"}
        unit="tickets"
        delta={null}
      />
      <HeroKpi
        label="Avg ticket"
        value={kpis ? formatUsd(kpis.avg) : "—"}
        unit="per order"
        delta={null}
      />
      <HeroKpi
        label="Invoice spend"
        value={invoiceSpend30d ? formatMoneyLarge(invoiceSpend) : "—"}
        unit="last 30d"
        delta={null}
      />
    </dl>
  )
}
