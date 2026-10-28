import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { getCountSetupSectionPromises } from "@/lib/counter/adapters/count"
import { SetupClient } from "./setup-client"

export const dynamic = "force-dynamic"

/** Count & waste — Setup: what's on the count, where it lives, and how it comes in. Owners only. */
export default async function Page() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (!hasOwnerAccess(session.user.role)) redirect("/dashboard/forbidden")

  const sections = getCountSetupSectionPromises({ accountId: session.user.accountId })

  return (
    <>
      <SetupClient sections={sections} />
      <span hidden data-perf-ready="/dashboard/count/setup" />
    </>
  )
}
