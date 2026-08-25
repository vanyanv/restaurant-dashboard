import { AdditionalMetrics } from "@/components/analytics/additional-metrics"
import { DashboardSection } from "@/components/analytics/dashboard-section"
import type { DashboardRange } from "@/lib/dashboard-utils"
import { fetchOtter } from "./data"

export async function AdditionalMetricsSection({
  range,
}: {
  range: DashboardRange
}) {
  const otter = await fetchOtter(range)
  if (!otter) return null

  return (
    <DashboardSection title="Additional Metrics">
      <AdditionalMetrics kpis={otter.kpis} />
    </DashboardSection>
  )
}
