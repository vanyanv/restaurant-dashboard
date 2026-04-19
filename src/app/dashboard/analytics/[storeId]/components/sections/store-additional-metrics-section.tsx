import { AdditionalMetrics } from "@/components/analytics/additional-metrics"
import type { DashboardRange } from "@/lib/dashboard-utils"
import { fetchOtter } from "./data"

export async function StoreAdditionalMetricsSection({
  storeId,
  range,
}: {
  storeId: string
  range: DashboardRange
}) {
  const analytics = await fetchOtter(storeId, range)
  if (!analytics) return null
  return <AdditionalMetrics kpis={analytics.kpis} />
}
