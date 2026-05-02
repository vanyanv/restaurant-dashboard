import { SystemHealthStrip } from "@/components/monitoring/bridge/system-health-strip"
import { AtRiskQuotas } from "@/components/monitoring/bridge/at-risk-quotas"
import { Last24hActivity } from "@/components/monitoring/bridge/last-24h-activity"
import { RecentEventsFeed } from "@/components/monitoring/bridge/recent-events-feed"
import { getAllSystemStatus } from "@/lib/monitoring/system-status"
import { getLatestVercelSnapshot, type VercelUsageMetrics } from "@/lib/monitoring/vercel-usage"
import {
  getAiCostByHour,
  getBridgeEvents,
  getErrorsByHour,
  getLoginsByHour,
} from "@/lib/monitoring/queries"

export const dynamic = "force-dynamic"

export default async function MonitoringBridgePage() {
  const [statuses, vercelSnap, errorsByHour, aiByHour, loginsByHour, events] =
    await Promise.all([
      getAllSystemStatus(),
      getLatestVercelSnapshot(),
      getErrorsByHour(24),
      getAiCostByHour(24),
      getLoginsByHour(24),
      getBridgeEvents(10),
    ])

  const metrics =
    (vercelSnap?.metrics as unknown as VercelUsageMetrics) ?? null

  return (
    <div className="flex flex-col gap-3">
      <SystemHealthStrip statuses={statuses} />
      <AtRiskQuotas metrics={metrics} />
      <Last24hActivity
        errorsByHour={errorsByHour}
        aiCostByHour={aiByHour}
        loginsByHour={loginsByHour}
      />
      <RecentEventsFeed rows={events} />
    </div>
  )
}
