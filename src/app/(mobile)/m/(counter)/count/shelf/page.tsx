import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { getInventoryShelfSectionPromises } from "@/lib/counter/adapters/inventory-shelf"
import { ShelfClient } from "@/app/dashboard/(counter)/count/shelf/shelf-client"

export const dynamic = "force-dynamic"

/** Inventory — Shelf on a phone: the desk client in the phone shell. */
export default async function Page({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (!hasOwnerAccess(session.user.role)) redirect("/m/forbidden")
  const sp = await searchParams

  const sections = getInventoryShelfSectionPromises({ accountId: session.user.accountId, storeId: sp.store })

  return (
    <>
      <ShelfClient sections={sections} />
      <span hidden data-perf-ready="/m/count/shelf" />
    </>
  )
}
