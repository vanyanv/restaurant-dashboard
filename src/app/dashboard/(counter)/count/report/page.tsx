import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { getInventoryReportSectionPromises } from "@/lib/counter/adapters/inventory-report"
import { getInventorySwitcherSectionPromises } from "@/lib/counter/adapters/inventory-shelf"
import { ReportClient } from "./report-client"

export const dynamic = "force-dynamic"

/** Inventory — Report: what went missing between two counts, item by item, with the working folded under it. Owners only. */
export default async function Page({ searchParams }: { searchParams: Promise<{ store?: string; count?: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (!hasOwnerAccess(session.user.role)) redirect("/dashboard/forbidden")
  const sp = await searchParams

  const sections = {
    ...getInventoryReportSectionPromises({ accountId: session.user.accountId, storeId: sp.store, countId: sp.count }),
    ...getInventorySwitcherSectionPromises({ accountId: session.user.accountId }),
  }

  return (
    <>
      <ReportClient sections={sections} />
      <span hidden data-perf-ready="/dashboard/count/report" />
    </>
  )
}
