import { ErrorsPanel } from "@/components/monitoring/errors-panel"
import { SyncsPanel } from "@/components/monitoring/syncs-panel"
import { ActivityFeed } from "@/components/monitoring/activity-feed"
import {
  getRecentErrors,
  getErrorsByHour,
  getSyncs,
  getRecentActivity,
} from "@/lib/monitoring/queries"

export const dynamic = "force-dynamic"

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string }>
}) {
  const params = await searchParams
  const storeId = params.store && params.store !== "all" ? params.store : null

  const [errors, errorsByHour, syncs, activity] = await Promise.all([
    getRecentErrors(50),
    getErrorsByHour(24),
    getSyncs(storeId),
    getRecentActivity(15),
  ])

  return (
    <div className="flex flex-col gap-6">
      <ActivityFeed rows={activity} />
      <div id="syncs">
        <SyncsPanel rows={syncs} />
      </div>
      <ErrorsPanel errors={errors} byHour={errorsByHour} />
    </div>
  )
}
