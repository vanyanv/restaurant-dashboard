import { KpiCards } from "@/components/analytics/kpi-cards"
import type { DashboardRange } from "@/lib/dashboard-utils"
import { fetchOtter } from "./data"

export async function StoreKpisSection({
  storeId,
  range,
}: {
  storeId: string
  range: DashboardRange
}) {
  const analytics = await fetchOtter(storeId, range)
  if (!analytics) return null
  return <KpiCards kpis={analytics.kpis} comparison={analytics.comparison} />
}
