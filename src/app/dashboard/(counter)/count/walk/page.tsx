import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { getCountWalkSectionPromises } from "@/lib/counter/adapters/count"
import { CountWalkClient } from "../count-walk-client"

export const dynamic = "force-dynamic"

/**
 * Inventory — the count: the walk on a phone, the sheet on the desk. Opened
 * by the pinned "Count <store>" button on the Overview and the Shelf tab.
 * Owners only.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (!hasOwnerAccess(session.user.role)) redirect("/dashboard/forbidden")
  const sp = await searchParams

  const sections = getCountWalkSectionPromises({ accountId: session.user.accountId, storeId: sp.store })

  return (
    <>
      <CountWalkClient sections={sections} />
      <span hidden data-perf-ready="/dashboard/count/walk" />
    </>
  )
}
