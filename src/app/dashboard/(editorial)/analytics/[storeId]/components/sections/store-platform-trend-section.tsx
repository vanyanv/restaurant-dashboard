import type { DashboardRange } from "@/lib/dashboard-utils"
import { PlatformTrendChartSlot } from "../chart-slots"
import { fetchOtter } from "./data"

export async function StorePlatformTrendSection({
  storeId,
  range,
}: {
  storeId: string
  range: DashboardRange
}) {
  const analytics = await fetchOtter(storeId, range)
  if (!analytics) return null
  return <PlatformTrendChartSlot data={analytics.platformTrends} />
}
