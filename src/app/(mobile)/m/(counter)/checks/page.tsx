import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { getChecksTodaySectionPromises } from "@/lib/counter/adapters/checks"
import { ChecksTodayClient } from "@/app/dashboard/(counter)/checks/checks-today-client"

export const dynamic = "force-dynamic"

/** Store checks on a phone — Today: every store by its three checks, missed ones first. Same adapter and client as the desk page. */
export default async function Page() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  // Photos and PINs are for owners only.
  if (!hasOwnerAccess(session.user.role)) redirect("/m/forbidden")

  const sections = getChecksTodaySectionPromises({ accountId: session.user.accountId })

  return (
    <>
      <ChecksTodayClient sections={sections} />
      <span hidden data-perf-ready="/m/checks" />
    </>
  )
}
