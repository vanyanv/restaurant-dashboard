import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { getInventoryShelfSectionPromises } from "@/lib/counter/adapters/inventory-shelf"
import { OverviewClient } from "./overview-client"

export const dynamic = "force-dynamic"

/**
 * Inventory — Overview: what to order now, the shelf as a picture, and the
 * three money figures, for one store or all of them. Owners only. The count
 * itself moved to `/dashboard/count/walk`.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ store?: string; walk?: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (!hasOwnerAccess(session.user.role)) redirect("/dashboard/forbidden")
  const sp = await searchParams
  // The count used to live here, and `?walk=1` was how the store picker opened
  // it on the next item: a link saved from then goes to where the count is now.
  if (sp.walk === "1") {
    redirect(`/dashboard/count/walk?${new URLSearchParams({ ...(sp.store ? { store: sp.store } : {}), walk: "1" })}`)
  }

  const sections = getInventoryShelfSectionPromises({ accountId: session.user.accountId, storeId: sp.store })

  return (
    <>
      <OverviewClient sections={sections} />
      <span hidden data-perf-ready="/dashboard/count" />
    </>
  )
}
