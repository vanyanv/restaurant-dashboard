import { DashboardSection } from "@/components/analytics/dashboard-section"
import type { DashboardRange } from "@/lib/dashboard-utils"
import { RevenueHeatmapSlot } from "../chart-slots"
import { fetchOtter } from "./data"

export async function RevenueTrendsSection({
  range,
}: {
  range: DashboardRange
}) {
  const otter = await fetchOtter(range)
  if (!otter) return null

  return (
    <DashboardSection title="Revenue Trends">
      <div className="grid gap-4 md:gap-6 lg:grid-cols-5">
        <RevenueHeatmapSlot
          data={otter.dailyTrends}
          className="lg:col-span-5"
        />
      </div>
    </DashboardSection>
  )
}
