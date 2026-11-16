import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { getCountWasteSectionPromises } from "@/lib/counter/adapters/count"
import { getInventorySwitcherSectionPromises } from "@/lib/counter/adapters/inventory-shelf"
import { PhoneWasteClient } from "./phone-waste-client"

export const dynamic = "force-dynamic"

/** The waste log on a phone — where `/dashboard/count/waste` lands a phone. */
export default async function Page({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (!hasOwnerAccess(session.user.role)) redirect("/m/forbidden")
  const sp = await searchParams

  const sections = {
    ...getCountWasteSectionPromises({ accountId: session.user.accountId, storeId: sp.store }),
    ...getInventorySwitcherSectionPromises({ accountId: session.user.accountId }),
  }

  return (
    <>
      <PhoneWasteClient sections={sections} />
      <span hidden data-perf-ready="/m/count/waste" />
    </>
  )
}
