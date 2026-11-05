import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getPeopleAccessSectionPromises } from "@/lib/counter/adapters/people-access"
import { CounterPeopleAccessClient } from "./counter-people-access-client"

export const dynamic = "force-dynamic"

/**
 * Admin > People: who can sign in, invites, removal. Developer only; the
 * admin layout redirects everyone else to /dashboard/forbidden, and every
 * action re-checks the role on the server.
 */
export default async function Page() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const sections = getPeopleAccessSectionPromises({ accountId: session.user.accountId, userId: session.user.id })

  return (
    <>
      <CounterPeopleAccessClient sections={sections} />
      <span hidden data-perf-ready="/dashboard/admin/people" />
    </>
  )
}
