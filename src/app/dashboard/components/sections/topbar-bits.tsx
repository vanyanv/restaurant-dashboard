import { OtterSyncButton } from "@/components/otter-sync-button"
import {
  formatDateRange,
  getLastSyncText,
  type DashboardRange,
} from "@/lib/dashboard-utils"
import { MobileStoreSwitcher } from "../topbar-slots"
import { fetchDashboard } from "./data"

export async function TopbarRangeStamp({ range }: { range: DashboardRange }) {
  const data = await fetchDashboard(range)
  if (!data?.dateRange) return null
  return <>{formatDateRange(data.dateRange.startDate, data.dateRange.endDate)}</>
}

export async function TopbarLastSync({ range }: { range: DashboardRange }) {
  const data = await fetchDashboard(range)
  return <span suppressHydrationWarning>{getLastSyncText(data?.lastSyncAt)}</span>
}

export async function TopbarSyncButton({ range }: { range: DashboardRange }) {
  const data = await fetchDashboard(range)
  return (
    <OtterSyncButton
      lastSyncAt={data?.lastSyncAt}
      variant="outline"
      size="sm"
    />
  )
}

export async function TopbarMobileStoreSwitcher({
  range,
}: {
  range: DashboardRange
}) {
  const data = await fetchDashboard(range)
  const stores =
    data?.rows
      .filter((r) => r.storeId !== "total")
      .map((r) => ({ id: r.storeId, name: r.storeName })) ?? []
  return <MobileStoreSwitcher stores={stores} />
}
