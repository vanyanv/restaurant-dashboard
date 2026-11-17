import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { getInventoryWasteSectionPromises } from "@/lib/counter/adapters/inventory-waste"
import { getInventorySwitcherSectionPromises } from "@/lib/counter/adapters/inventory-shelf"
import { WasteClient } from "./waste-client"

export const dynamic = "force-dynamic"

/** Inventory — Waste: what was thrown out in the last 7 days, why and where, and the form that logs it. Owners only. */
export default async function Page({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (!hasOwnerAccess(session.user.role)) redirect("/dashboard/forbidden")
  const sp = await searchParams

  const sections = {
    ...getInventoryWasteSectionPromises({ accountId: session.user.accountId, storeId: sp.store }),
    ...getInventorySwitcherSectionPromises({ accountId: session.user.accountId }),
  }

  return (
    <>
      <WasteClient sections={sections} />
      <span hidden data-perf-ready="/dashboard/count/waste" />
    </>
  )
}
