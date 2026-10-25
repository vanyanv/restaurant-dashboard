import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getChecksCrewSectionPromises } from "@/lib/counter/adapters/checks"
import { ChecksCrewClient } from "./checks-crew-client"

export const dynamic = "force-dynamic"

/** Store checks — Crew & PINs: who can sign checks at a store, and their PINs. Owners only. */
export default async function Page({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  const sp = await searchParams

  const sections = getChecksCrewSectionPromises({ accountId: session.user.accountId, storeId: sp.store })

  return (
    <>
      <ChecksCrewClient sections={sections} />
      <span hidden data-perf-ready="/dashboard/checks/crew" />
    </>
  )
}
