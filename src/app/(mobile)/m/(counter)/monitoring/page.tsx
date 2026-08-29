import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getMonitoringSectionPromises } from "@/lib/counter/adapters/monitoring"
import { CounterPhoneMonitoringClient } from "./counter-phone-monitoring-client"

export const dynamic = "force-dynamic"

/** Monitoring, on a phone — `P.monitoring.phone()`. */
export default async function MobileMonitoringPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const sections = getMonitoringSectionPromises({ accountId: session.user.accountId })

  return (
    <>
      <CounterPhoneMonitoringClient sections={sections} />
      <span hidden data-perf-ready="/m/monitoring" />
    </>
  )
}
