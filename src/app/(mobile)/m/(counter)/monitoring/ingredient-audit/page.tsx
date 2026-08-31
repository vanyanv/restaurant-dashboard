import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getAuditSectionPromises } from "@/lib/counter/adapters/monitoring-ingredients"
import { CounterPhoneAuditClient } from "./counter-phone-audit-client"

export const dynamic = "force-dynamic"

/** See the adapter's docblock. No owner gate — the monitoring shell's note explains why. */
export default async function Page() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const sections = getAuditSectionPromises()

  return (
    <>
      <CounterPhoneAuditClient sections={sections} />
      <span hidden data-perf-ready="/m/monitoring/ingredient-audit" />
    </>
  )
}
