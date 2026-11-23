import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { getScreensSectionPromises } from "@/lib/counter/adapters/screens"
import { ScreensClient } from "./screens-client"

export const dynamic = "force-dynamic"

/** Screens: the TVs in every store, what they play, and the images. */
export default async function Page() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (!hasOwnerAccess(session.user.role)) redirect("/dashboard/forbidden")

  const sections = getScreensSectionPromises({ accountId: session.user.accountId })

  return (
    <>
      <ScreensClient sections={sections} />
      <span hidden data-perf-ready="/dashboard/screens" />
    </>
  )
}
