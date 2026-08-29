import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getMlSectionPromises } from "@/lib/counter/adapters/monitoring-ml"
import { CounterMlClient } from "./counter-ml-client"

export const dynamic = "force-dynamic"

/** See the adapter's docblock. No owner gate — the monitoring shell's note explains why. */
export default async function Page() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const sections = getMlSectionPromises()

  return (
    <>
      <CounterMlClient sections={sections} />
      <span hidden data-perf-ready="/dashboard/admin/monitoring/ml" />
    </>
  )
}
