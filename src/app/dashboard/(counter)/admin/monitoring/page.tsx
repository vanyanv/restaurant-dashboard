import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getMonitoringSectionPromises } from "@/lib/counter/adapters/monitoring"
import { CounterMonitoringClient } from "./counter-monitoring-client"

export const dynamic = "force-dynamic"

/**
 * Monitoring — `P.monitoring` (`docs/counter/counter-prototype.html`).
 *
 * No date control: `P.monitoring` has no `nodate` flag but every figure on it
 * is a fixed trailing window (24 hours, 7 days) chosen by what the underlying
 * tables retain, not by a reader. A control that narrowed nothing would be a
 * control that lies.
 *
 * NO OWNER GATE, and that is not an oversight. The prototype's sub reads
 * "Developer only · not visible to the owner", and no gate in this product can
 * deliver that: `Role` holds only OWNER and DEVELOPER and every access helper
 * accepts both. Adding `hasOwnerAccess` here would be a gate that reads as a
 * restriction and admits everyone — worse than none, because it would be
 * believed.
 */
export default async function MonitoringPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const sections = getMonitoringSectionPromises({ accountId: session.user.accountId })

  return (
    <>
      <CounterMonitoringClient sections={sections} />
      <span hidden data-perf-ready="/dashboard/admin/monitoring" />
    </>
  )
}
