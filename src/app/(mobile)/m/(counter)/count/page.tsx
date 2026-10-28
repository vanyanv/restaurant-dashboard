import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { getCountWalkSectionPromises } from "@/lib/counter/adapters/count"
import { PhoneCountClient } from "./phone-count-client"

export const dynamic = "force-dynamic"

/**
 * The weekly count on a phone — where `/dashboard/count` lands a phone.
 *
 * This path used to be a 308 onto `/m/operations/inventory/count/new`, kept
 * for links to the editorial counting flow it replaced. The count walk is the
 * counting screen now, so the path is a page again.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (!hasOwnerAccess(session.user.role)) redirect("/m/forbidden")
  const sp = await searchParams

  const sections = getCountWalkSectionPromises({ accountId: session.user.accountId, storeId: sp.store })

  return (
    <>
      <PhoneCountClient sections={sections} />
      <span hidden data-perf-ready="/m/count" />
    </>
  )
}
