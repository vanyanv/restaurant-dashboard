import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getInfraSectionPromises } from "@/lib/counter/adapters/monitoring-infra"
import { CounterInfraClient } from "./counter-infra-client"

export const dynamic = "force-dynamic"

/** See the adapter's docblock. No owner gate — the monitoring shell's note explains why. */
export default async function Page() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const sections = getInfraSectionPromises()

  return (
    <>
      <CounterInfraClient sections={sections} />
      <span hidden data-perf-ready="/dashboard/admin/monitoring/infrastructure" />
    </>
  )
}
