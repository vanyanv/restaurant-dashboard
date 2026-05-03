import { SystemHealthStrip } from "@/components/monitoring/bridge/system-health-strip"
import { Last24hActivity } from "@/components/monitoring/bridge/last-24h-activity"
import { RecentEventsFeed } from "@/components/monitoring/bridge/recent-events-feed"
import { getAllSystemStatus } from "@/lib/monitoring/system-status"
import {
  getAiCostByHour,
  getBridgeEvents,
  getErrorsByHour,
  getLoginsByHour,
} from "@/lib/monitoring/queries"

export const dynamic = "force-dynamic"

export default async function MonitoringBridgePage() {
  const [statuses, errorsByHour, aiByHour, loginsByHour, events] =
    await Promise.all([
      getAllSystemStatus(),
      getErrorsByHour(24),
      getAiCostByHour(24),
      getLoginsByHour(24),
      getBridgeEvents(10),
    ])

  return (
    <div className="flex flex-col gap-3">
      <SystemHealthStrip statuses={statuses} />
      <Last24hActivity
        errorsByHour={errorsByHour}
        aiCostByHour={aiByHour}
        loginsByHour={loginsByHour}
      />
      <RecentEventsFeed rows={events} />
    </div>
  )
}
