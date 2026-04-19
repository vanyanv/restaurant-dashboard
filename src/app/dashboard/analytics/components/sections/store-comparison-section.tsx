import { DashboardSection } from "@/components/analytics/dashboard-section"
import type { DashboardRange } from "@/lib/dashboard-utils"
import { StoreComparisonChartSlot } from "../chart-slots"
import { fetchDashboard } from "./data"

export async function StoreComparisonSection({
  range,
}: {
  range: DashboardRange
}) {
  const data = await fetchDashboard(range)
  if (!data || data.rows.length <= 1) return null

  const comparisonData = data.rows
    .filter((r) => r.storeId !== "total")
    .map((r) => ({
      storeName: r.storeName,
      grossSales: r.grossSales,
      netSales: r.netSales,
    }))

  return (
    <DashboardSection title="Store Comparison">
      <StoreComparisonChartSlot data={comparisonData} />
    </DashboardSection>
  )
}
