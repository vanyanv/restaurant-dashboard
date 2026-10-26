import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { getChecksHistorySectionPromises } from "@/lib/counter/adapters/checks"
import { ChecksHistoryClient } from "./checks-history-client"

export const dynamic = "force-dynamic"

/** Store checks — History: store × check rows by day, with the detail of any square. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; store?: string }>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  // Photos and PINs are for owners only.
  if (!hasOwnerAccess(session.user.role)) redirect("/dashboard/forbidden")
  const sp = await searchParams

  const sections = getChecksHistorySectionPromises({
    accountId: session.user.accountId,
    range: Number(sp.range) || 14,
    storeId: sp.store,
  })

  return (
    <>
      <ChecksHistoryClient sections={sections} />
      <span hidden data-perf-ready="/dashboard/checks/history" />
    </>
  )
}
