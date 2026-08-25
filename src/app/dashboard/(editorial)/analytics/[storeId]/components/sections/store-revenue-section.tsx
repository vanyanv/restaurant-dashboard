import type { DashboardRange } from "@/lib/dashboard-utils"
import { RevenueTrendChartSlot, RevenueHeatmapSlot } from "../chart-slots"
import { fetchOtter } from "./data"

export async function StoreRevenueSection({
  storeId,
  range,
}: {
  storeId: string
  range: DashboardRange
}) {
  const analytics = await fetchOtter(storeId, range)
  if (!analytics) return null

  return (
    <div className="grid gap-4 md:grid-cols-5">
      <RevenueTrendChartSlot className="md:col-span-3" />
      <RevenueHeatmapSlot
        data={analytics.dailyTrends}
        className="md:col-span-2"
      />
    </div>
  )
}
