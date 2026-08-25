import { prisma } from "@/lib/prisma"
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

  // Stores still in build-out have nothing to compare — empty rows here
  // just pad the chart with $0 bars.
  const preOpen = await prisma.store.findMany({
    where: { lifecycleStage: "pre_open" },
    select: { id: true },
  })
  const preOpenIds = new Set(preOpen.map((s) => s.id))

  const comparisonData = data.rows
    .filter((r) => r.storeId !== "total" && !preOpenIds.has(r.storeId))
    .map((r) => ({
      storeName: r.storeName,
      grossSales: r.grossSales,
      netSales: r.netSales,
    }))

  // A comparison of one store is a bar with no argument — wait for the
  // second store to start trading.
  if (comparisonData.length < 2) return null

  return (
    <DashboardSection title="Store Comparison">
      <StoreComparisonChartSlot data={comparisonData} />
    </DashboardSection>
  )
}
