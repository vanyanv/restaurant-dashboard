import { ErrorsPanel } from "@/components/monitoring/errors-panel"
import { SyncsPanel } from "@/components/monitoring/syncs-panel"
import { ActivityFeed } from "@/components/monitoring/activity-feed"
import { StoreSyncGrid } from "@/components/monitoring/store-sync-grid"
import { PendingDetailsCard } from "@/components/monitoring/pending-details-card"
import { StaleStoresCard } from "@/components/monitoring/stale-stores-card"
import {
  getRecentErrors,
  getErrorsByHour,
  getSyncs,
  getRecentActivity,
  getSyncsByStore,
  getPendingOrderDetails,
  getStaleStores,
} from "@/lib/monitoring/queries"

export const dynamic = "force-dynamic"

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string }>
}) {
  const params = await searchParams
  const storeId = params.store && params.store !== "all" ? params.store : null

  const [
    errors,
    errorsByHour,
    syncs,
    activity,
    storeSyncGrid,
    pendingDetails,
    staleStores,
  ] = await Promise.all([
    getRecentErrors(50),
    getErrorsByHour(24),
    getSyncs(storeId),
    getRecentActivity(15),
    getSyncsByStore(),
    getPendingOrderDetails(),
    getStaleStores(),
  ])

  return (
    <div className="flex flex-col gap-6">
      <ActivityFeed rows={activity} />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
          gap: 24,
        }}
      >
        <StaleStoresCard rows={staleStores} />
        <PendingDetailsCard rows={pendingDetails} />
      </div>

      <StoreSyncGrid grid={storeSyncGrid} />

      <div id="syncs">
        <SyncsPanel rows={syncs} />
      </div>
      <ErrorsPanel errors={errors} byHour={errorsByHour} />
    </div>
  )
}
