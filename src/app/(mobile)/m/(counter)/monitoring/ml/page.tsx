import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getMlSectionPromises } from "@/lib/counter/adapters/monitoring-ml"
import { CounterPhoneMlClient } from "./counter-phone-ml-client"

export const dynamic = "force-dynamic"

/** See the adapter's docblock. Reads are account-scoped; the shell's
 *  note explains why there is still no developer-only gate. */
export default async function Page() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const sections = getMlSectionPromises({ accountId: session.user.accountId })

  return (
    <>
      <CounterPhoneMlClient sections={sections} />
      <span hidden data-perf-ready="/m/monitoring/ml" />
    </>
  )
}
