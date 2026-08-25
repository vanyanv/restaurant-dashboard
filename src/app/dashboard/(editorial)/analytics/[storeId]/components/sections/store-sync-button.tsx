import { OtterSyncButton } from "@/components/otter-sync-button"
import type { DashboardRange } from "@/lib/dashboard-utils"
import { fetchOtter } from "./data"

export async function StoreSyncButton({
  storeId,
  range,
}: {
  storeId: string
  range: DashboardRange
}) {
  const analytics = await fetchOtter(storeId, range)
  return <OtterSyncButton lastSyncAt={analytics?.lastSyncAt} />
}
