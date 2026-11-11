import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { getChecksReportSectionPromises } from "@/lib/counter/adapters/checks"
import { ChecksReportClient } from "./checks-report-client"

export const dynamic = "force-dynamic"

/** Store checks — Report: what the saved ticks say over 7, 14 or 30 days. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; store?: string }>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  // Crew names and their work are for owners only, like the rest of Store checks.
  if (!hasOwnerAccess(session.user.role)) redirect("/dashboard/forbidden")
  const sp = await searchParams

  const sections = getChecksReportSectionPromises({
    accountId: session.user.accountId,
    range: Number(sp.range) || 14,
    storeId: sp.store,
  })

  return (
    <>
      <ChecksReportClient sections={sections} />
      <span hidden data-perf-ready="/dashboard/checks/report" />
    </>
  )
}
