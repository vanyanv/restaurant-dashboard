import { DashboardSection } from "@/components/analytics/dashboard-section"
import { PlatformInsights } from "@/components/analytics/platform-insights"
import type { DashboardRange } from "@/lib/dashboard-utils"
import {
  PaymentSplitChartSlot,
  PlatformBreakdownChartSlot,
  PlatformTrendChartSlot,
} from "../chart-slots"
import { fetchOtter } from "./data"

export async function PlatformAnalysisSection({
  range,
}: {
  range: DashboardRange
}) {
  const otter = await fetchOtter(range)
  if (!otter) return null

  return (
    <DashboardSection title="Platform Analysis">
      <PlatformInsights data={otter.platformBreakdown} />
      <PlatformTrendChartSlot data={otter.platformTrends} />
      <div className="grid gap-4 md:gap-6 md:grid-cols-3">
        <PlatformBreakdownChartSlot
          data={otter.platformBreakdown}
          className="md:col-span-2"
        />
        <PaymentSplitChartSlot data={otter.paymentSplit} />
      </div>
    </DashboardSection>
  )
}
