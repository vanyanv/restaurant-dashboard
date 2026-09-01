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
 * THE OWNER GATE IS REAL NOW, and it is one directory up. This docblock used
 * to argue that no gate in this product could deliver the prototype's
 * "Developer only · not visible to the owner", because `Role` holds only OWNER
 * and DEVELOPER and every access helper accepts both. That was half right:
 * `hasOwnerAccess` accepts both, so it is the wrong helper — but a direct
 * `role !== "DEVELOPER"` is not, and `/api/monitoring/summary` has been making
 * exactly that comparison all along. The API was developer-only and this page
 * was not.
 *
 * `src/app/dashboard/(counter)/admin/layout.tsx` makes the comparison for the
 * whole segment and sends an owner to `/dashboard/forbidden`. This page keeps
 * only its session check, because a layout that has already refused everyone
 * who should be refused does not need the page to refuse them again.
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
