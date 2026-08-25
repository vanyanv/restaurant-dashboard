import { DailyTable } from "@/components/analytics/daily-table"
import type { DashboardRange } from "@/lib/dashboard-utils"
import { fetchOtter } from "./data"

export async function StoreDailyTableSection({
  storeId,
  range,
}: {
  storeId: string
  range: DashboardRange
}) {
  const analytics = await fetchOtter(storeId, range)
  if (!analytics) return null
  return <DailyTable data={analytics.dailyTrends} />
}
