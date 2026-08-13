import { PresenceList } from "@/components/monitoring/people/presence-list"
import { LoginHistoryTable } from "@/components/monitoring/people/login-history-table"
import { EngagementSummary } from "@/components/monitoring/people/engagement-summary"
import { ActivityCalendar } from "@/components/monitoring/people/activity-calendar"
import { SessionsTable } from "@/components/monitoring/people/sessions-table"
import { TopRoutesPanel } from "@/components/monitoring/people/top-routes-panel"
import { getLivePresence, getLoginHistory } from "@/lib/monitoring/login-audit"
import { getEngagementData } from "@/lib/monitoring/engagement"

export const dynamic = "force-dynamic"

export default async function PeoplePage() {
  const [presence, history, engagement] = await Promise.all([
    getLivePresence(),
    getLoginHistory(100),
    getEngagementData(30),
  ])

  // Sessions are shown for the most recently active user — with one operator
  // that is always the right one, and a per-user picker would be furniture.
  const primary = engagement.summary[0]

  return (
    <div className="flex flex-col gap-6">
      <PresenceList users={presence} />
      <EngagementSummary rows={engagement.summary} />
      <ActivityCalendar days={engagement.activeDays} />
      {primary && (
        <SessionsTable
          sessions={engagement.sessionsByUser[primary.userId] ?? []}
          userName={primary.name}
        />
      )}
      <TopRoutesPanel routes={engagement.topRoutes} />
      <LoginHistoryTable rows={history} />
    </div>
  )
}
