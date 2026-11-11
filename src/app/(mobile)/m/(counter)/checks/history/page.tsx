import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { getChecksHistorySectionPromises } from "@/lib/counter/adapters/checks"
import { ChecksHistoryPhone } from "./checks-history-phone"

export const dynamic = "force-dynamic"

/** Store checks on a phone — History: store × check rows by day, a card per day, newest first. Same adapter as the desk page, laid out for a phone. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; store?: string }>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  // Photos and PINs are for owners only.
  if (!hasOwnerAccess(session.user.role)) redirect("/m/forbidden")
  const sp = await searchParams

  const sections = getChecksHistorySectionPromises({
    accountId: session.user.accountId,
    range: Number(sp.range) || 14,
    storeId: sp.store,
  })

  return (
    <>
      <ChecksHistoryPhone sections={sections} />
      <span hidden data-perf-ready="/m/checks/history" />
    </>
  )
}
