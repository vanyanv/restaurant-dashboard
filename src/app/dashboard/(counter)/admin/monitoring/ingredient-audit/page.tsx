import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getAuditSectionPromises } from "@/lib/counter/adapters/monitoring-ingredients"
import { CounterIngredientAuditClient } from "./counter-ingredient-audit-client"

export const dynamic = "force-dynamic"

/** See the adapter's docblock. Reads are account-scoped; the shell's
 *  note explains why there is still no developer-only gate. */
export default async function Page() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const sections = getAuditSectionPromises({ accountId: session.user.accountId })

  return (
    <>
      <CounterIngredientAuditClient sections={sections} />
      <span hidden data-perf-ready="/dashboard/admin/monitoring/ingredient-audit" />
    </>
  )
}
