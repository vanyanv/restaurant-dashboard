import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getPeopleSectionPromises } from "@/lib/counter/adapters/monitoring-people"
import { CounterPhonePeopleClient } from "./counter-phone-people-client"

export const dynamic = "force-dynamic"

/** See the adapter's docblock. Reads are account-scoped; the shell's
 *  note explains why there is still no developer-only gate. */
export default async function Page() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const sections = getPeopleSectionPromises({ accountId: session.user.accountId })

  return (
    <>
      <CounterPhonePeopleClient sections={sections} />
      <span hidden data-perf-ready="/m/monitoring/people" />
    </>
  )
}
