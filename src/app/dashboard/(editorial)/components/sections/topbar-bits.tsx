import { OtterSyncButton } from "@/components/otter-sync-button"
import { formatDateRange, getLastSyncText } from "@/lib/dashboard-utils"
import { MobileStoreSwitcher } from "../topbar-slots"
import type { DashboardPromise } from "./data"

export async function TopbarRangeStamp({
  dashboardPromise,
}: {
  dashboardPromise: DashboardPromise
}) {
  const data = await dashboardPromise
  if (!data?.dateRange) return null
  return <>{formatDateRange(data.dateRange.startDate, data.dateRange.endDate)}</>
}

export async function TopbarLastSync({
  dashboardPromise,
}: {
  dashboardPromise: DashboardPromise
}) {
  const data = await dashboardPromise
  return <span suppressHydrationWarning>{getLastSyncText(data?.lastSyncAt)}</span>
}

export async function TopbarSyncButton({
  dashboardPromise,
}: {
  dashboardPromise: DashboardPromise
}) {
  const data = await dashboardPromise
  return (
    <OtterSyncButton
      lastSyncAt={data?.lastSyncAt}
      variant="outline"
      size="sm"
    />
  )
}

export async function TopbarMobileStoreSwitcher({
  dashboardPromise,
}: {
  dashboardPromise: DashboardPromise
}) {
  const data = await dashboardPromise
  const stores =
    data?.rows
      .filter((r) => r.storeId !== "total")
      .map((r) => ({ id: r.storeId, name: r.storeName })) ?? []
  return <MobileStoreSwitcher stores={stores} />
}
