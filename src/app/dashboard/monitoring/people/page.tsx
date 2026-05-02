import { PresenceList } from "@/components/monitoring/people/presence-list"
import { LoginHistoryTable } from "@/components/monitoring/people/login-history-table"
import { getLivePresence, getLoginHistory } from "@/lib/monitoring/login-audit"

export const dynamic = "force-dynamic"

export default async function PeoplePage() {
  const [presence, history] = await Promise.all([
    getLivePresence(),
    getLoginHistory(100),
  ])
  return (
    <div className="flex flex-col gap-6">
      <PresenceList users={presence} />
      <LoginHistoryTable rows={history} />
    </div>
  )
}
