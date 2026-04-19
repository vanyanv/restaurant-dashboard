import { HeroKpi, formatMoneyLarge, formatUsd } from "../hero-kpi"
import type { DashboardRange } from "@/lib/dashboard-utils"
import { fetchOtter } from "./data"

export async function HeroKpisSection({ range }: { range: DashboardRange }) {
  const otter = await fetchOtter(range)

  const kpis = otter
    ? {
        gross: otter.kpis.grossRevenue,
        orders: otter.kpis.totalOrders,
        avg: otter.kpis.averageOrderValue,
      }
    : null

  return (
    <dl className="editorial-kpi-strip editorial-kpi-strip-wide dock-in dock-in-2">
      <HeroKpi
        label="Gross sales"
        value={kpis ? formatMoneyLarge(kpis.gross) : "—"}
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
    </dl>
  )
}
