import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { getCountSetupSectionPromises } from "@/lib/counter/adapters/count"
import { SetupClient } from "@/app/dashboard/(counter)/count/setup/setup-client"

export const dynamic = "force-dynamic"

/** Count & waste — Setup on a phone: the desk client, drawn in the phone shell. Owners only. */
export default async function Page() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (!hasOwnerAccess(session.user.role)) redirect("/m/forbidden")

  const sections = getCountSetupSectionPromises({ accountId: session.user.accountId })

  return (
    <>
      <SetupClient sections={sections} />
      <span hidden data-perf-ready="/m/count/setup" />
    </>
  )
}
