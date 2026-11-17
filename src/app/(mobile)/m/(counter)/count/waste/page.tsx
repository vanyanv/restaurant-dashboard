import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { getInventoryWasteSectionPromises } from "@/lib/counter/adapters/inventory-waste"
import { getInventorySwitcherSectionPromises } from "@/lib/counter/adapters/inventory-shelf"
import { WasteClient } from "@/app/dashboard/(counter)/count/waste/waste-client"

export const dynamic = "force-dynamic"

/** Inventory — Waste on a phone: the desk client in the phone shell. */
export default async function Page({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (!hasOwnerAccess(session.user.role)) redirect("/m/forbidden")
  const sp = await searchParams

  const sections = {
    ...getInventoryWasteSectionPromises({ accountId: session.user.accountId, storeId: sp.store }),
    ...getInventorySwitcherSectionPromises({ accountId: session.user.accountId }),
  }

  return (
    <>
      <WasteClient sections={sections} />
      <span hidden data-perf-ready="/m/count/waste" />
    </>
  )
}
