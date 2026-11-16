import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { getCountWalkSectionPromises } from "@/lib/counter/adapters/count"
import { PhoneCountClient } from "./phone-count-client"

export const dynamic = "force-dynamic"

/**
 * The count on a phone — where `/dashboard/count/walk` lands a phone. It was
 * `/m/count` until the Overview took that path.
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
      <span hidden data-perf-ready="/m/count/walk" />
    </>
  )
}
