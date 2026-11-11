import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { getChecksReportSectionPromises } from "@/lib/counter/adapters/checks"
import { ChecksReportClient } from "@/app/dashboard/(counter)/checks/report/checks-report-client"

export const dynamic = "force-dynamic"

/** Store checks on a phone — Report. Same adapter and client as the desk; the layout stacks in counter-checks.css. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; store?: string }>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (!hasOwnerAccess(session.user.role)) redirect("/m/forbidden")
  const sp = await searchParams

  const sections = getChecksReportSectionPromises({
    accountId: session.user.accountId,
    range: Number(sp.range) || 14,
    storeId: sp.store,
  })

  return (
    <>
      <ChecksReportClient sections={sections} />
      <span hidden data-perf-ready="/m/checks/report" />
    </>
  )
}
