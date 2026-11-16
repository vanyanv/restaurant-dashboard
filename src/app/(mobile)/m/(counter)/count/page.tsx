import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { getInventoryShelfSectionPromises } from "@/lib/counter/adapters/inventory-shelf"
import { OverviewClient } from "@/app/dashboard/(counter)/count/overview-client"

export const dynamic = "force-dynamic"

/**
 * Inventory on a phone — where `/dashboard/count` lands a phone. The Overview:
 * what to order now, the shelf as a picture, the three money figures. The
 * count walk that used to be this page is `/m/count/walk`.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ store?: string; walk?: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (!hasOwnerAccess(session.user.role)) redirect("/m/forbidden")
  const sp = await searchParams
  // The count used to live here, and `?walk=1` was how the store picker opened
  // it on the next item: a link saved from then goes to where the count is now.
  if (sp.walk === "1") {
    redirect(`/m/count/walk?${new URLSearchParams({ ...(sp.store ? { store: sp.store } : {}), walk: "1" })}`)
  }

  const sections = getInventoryShelfSectionPromises({ accountId: session.user.accountId, storeId: sp.store })

  return (
    <>
      <OverviewClient sections={sections} />
      <span hidden data-perf-ready="/m/count" />
    </>
  )
}
