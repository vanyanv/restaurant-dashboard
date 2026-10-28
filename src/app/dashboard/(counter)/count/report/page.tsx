import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { getCountReportSectionPromises } from "@/lib/counter/adapters/count"
import { ReportClient } from "./report-client"

export const dynamic = "force-dynamic"

/** Count & waste — Report: what should have been there against what was counted, and how often things are ordered. */
export default async function Page({ searchParams }: { searchParams: Promise<{ store?: string; count?: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (!hasOwnerAccess(session.user.role)) redirect("/dashboard/forbidden")
  const sp = await searchParams

  const sections = getCountReportSectionPromises({ accountId: session.user.accountId, storeId: sp.store, countId: sp.count })

  return (
    <>
      <ReportClient sections={sections} />
      <span hidden data-perf-ready="/dashboard/count/report" />
    </>
  )
}
