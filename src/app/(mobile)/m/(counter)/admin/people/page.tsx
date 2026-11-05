import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getPeopleAccessSectionPromises } from "@/lib/counter/adapters/people-access"
import { CounterPeopleAccessClient } from "@/app/dashboard/(counter)/admin/people/counter-people-access-client"

export const dynamic = "force-dynamic"

/** People on a phone. Same adapter and client as the desk page; rows stack as cards. Developer only. */
export default async function Page() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/m/login")
  if (session.user.role !== "DEVELOPER") redirect("/m/forbidden")

  const sections = getPeopleAccessSectionPromises({ accountId: session.user.accountId, userId: session.user.id })

  return (
    <>
      <CounterPeopleAccessClient sections={sections} />
      <span hidden data-perf-ready="/m/admin/people" />
    </>
  )
}
