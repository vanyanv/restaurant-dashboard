import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getChecksChecklistsSectionPromises } from "@/lib/counter/adapters/checks"
import { ChecksChecklistsClient } from "./checks-checklists-client"

export const dynamic = "force-dynamic"

/** Store checks — Checklists: each check's window, sections, photo rule and items, in English and Spanish. */
export default async function Page({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  const sp = await searchParams

  const sections = getChecksChecklistsSectionPromises({ accountId: session.user.accountId, storeId: sp.store })

  return (
    <>
      <ChecksChecklistsClient sections={sections} />
      <span hidden data-perf-ready="/dashboard/checks/checklists" />
    </>
  )
}
