import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { getCountWasteSectionPromises } from "@/lib/counter/adapters/count"
import { WasteClient } from "./waste-client"

export const dynamic = "force-dynamic"

/** Count & waste — Waste: log what was thrown out, and the last 7 days. Owners only. */
export default async function Page({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (!hasOwnerAccess(session.user.role)) redirect("/dashboard/forbidden")
  const sp = await searchParams

  const sections = getCountWasteSectionPromises({ accountId: session.user.accountId, storeId: sp.store })

  return (
    <>
      <WasteClient sections={sections} />
      <span hidden data-perf-ready="/dashboard/count/waste" />
    </>
  )
}
