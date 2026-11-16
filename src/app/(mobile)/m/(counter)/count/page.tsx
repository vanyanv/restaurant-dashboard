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
export default async function Page({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (!hasOwnerAccess(session.user.role)) redirect("/m/forbidden")
  const sp = await searchParams

  const sections = getInventoryShelfSectionPromises({ accountId: session.user.accountId, storeId: sp.store })

  return (
    <>
      <OverviewClient sections={sections} />
      <span hidden data-perf-ready="/m/count" />
    </>
  )
}
