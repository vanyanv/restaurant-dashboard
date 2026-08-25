import { OtterSyncButton } from "@/components/otter-sync-button"
import {
  formatDateRange,
  getLastSyncText,
  type DashboardRange,
} from "@/lib/dashboard-utils"
import { fetchDashboard } from "./data"

export async function AnalyticsDateStamp({
  range,
}: {
  range: DashboardRange
}) {
  const data = await fetchDashboard(range)
  if (!data?.dateRange) return null
  return (
    <span>
      {formatDateRange(data.dateRange.startDate, data.dateRange.endDate)}
    </span>
  )
}

export async function AnalyticsLastSync({
  range,
}: {
  range: DashboardRange
}) {
  const data = await fetchDashboard(range)
  return <span>{getLastSyncText(data?.lastSyncAt)}</span>
}

export async function AnalyticsSyncButton({
  range,
}: {
  range: DashboardRange
}) {
  const data = await fetchDashboard(range)
  return (
    <OtterSyncButton
      lastSyncAt={data?.lastSyncAt}
      variant="outline"
      size="sm"
    />
  )
}
