import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { getChecksPostersSectionPromises } from "@/lib/counter/adapters/checks"
import { ChecksPostersClient } from "@/app/dashboard/(counter)/checks/posters/checks-posters-client"

export const dynamic = "force-dynamic"

/** Store checks on a phone — QR posters: one printable poster per store, linking to that store's check page. Same adapter and client as the desk page. */
export default async function Page() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  // Photos and PINs are for owners only.
  if (!hasOwnerAccess(session.user.role)) redirect("/m/forbidden")

  const sections = getChecksPostersSectionPromises({ accountId: session.user.accountId })

  return (
    <>
      <ChecksPostersClient sections={sections} />
      <span hidden data-perf-ready="/m/checks/posters" />
    </>
  )
}
