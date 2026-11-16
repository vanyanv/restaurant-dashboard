import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { getCountReportSectionPromises } from "@/lib/counter/adapters/count"
import { getInventorySwitcherSectionPromises } from "@/lib/counter/adapters/inventory-shelf"
import { ReportClient } from "@/app/dashboard/(counter)/count/report/report-client"

export const dynamic = "force-dynamic"

/** Count & waste — Report on a phone: the desk client, drawn in the phone shell. */
export default async function Page({ searchParams }: { searchParams: Promise<{ store?: string; count?: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (!hasOwnerAccess(session.user.role)) redirect("/m/forbidden")
  const sp = await searchParams

  const sections = {
    ...getCountReportSectionPromises({ accountId: session.user.accountId, storeId: sp.store, countId: sp.count }),
    ...getInventorySwitcherSectionPromises({ accountId: session.user.accountId }),
  }

  return (
    <>
      <ReportClient sections={sections} />
      <span hidden data-perf-ready="/m/count/report" />
    </>
  )
}
