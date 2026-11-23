import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { getScreensSectionPromises } from "@/lib/counter/adapters/screens"
import { ScreensClient } from "@/app/dashboard/(counter)/screens/screens-client"

export const dynamic = "force-dynamic"

/** Screens on a phone: the desk client in the phone shell. */
export default async function Page() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (!hasOwnerAccess(session.user.role)) redirect("/m/forbidden")

  const sections = getScreensSectionPromises({ accountId: session.user.accountId })

  return (
    <>
      <ScreensClient sections={sections} />
      <span hidden data-perf-ready="/m/screens" />
    </>
  )
}
