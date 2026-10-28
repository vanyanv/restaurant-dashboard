import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { getChecksCrewSectionPromises } from "@/lib/counter/adapters/checks"
import { ChecksCrewClient } from "@/app/dashboard/(counter)/checks/crew/checks-crew-client"

export const dynamic = "force-dynamic"

/** Store checks on a phone — Crew & PINs: who can sign checks at a store, and their PINs. Owners only. Same adapter and client as the desk page. */
export default async function Page({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  // Photos and PINs are for owners only.
  if (!hasOwnerAccess(session.user.role)) redirect("/m/forbidden")
  const sp = await searchParams

  const sections = getChecksCrewSectionPromises({ accountId: session.user.accountId, storeId: sp.store })

  return (
    <>
      <ChecksCrewClient sections={sections} />
      <span hidden data-perf-ready="/m/checks/crew" />
    </>
  )
}
