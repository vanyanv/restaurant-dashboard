import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { readCounterParams } from "@/lib/counter/url-state"
import { getStockCountsSectionPromises } from "@/lib/counter/adapters/stock-counts"
import { CounterPhoneCountsClient } from "./counter-phone-counts-client"

export const dynamic = "force-dynamic"

/** Stock counts, on a phone — `P.counts.phone()`. */
export default async function MobileCountsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const sp = await searchParams
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === "string") params.set(key, value)
  }

  const today = new Date()
  const counterParams = readCounterParams(params, today)

  const sections = getStockCountsSectionPromises({
    storeId: counterParams.storeId,
    accountId: session.user.accountId,
    range: counterParams.range,
  })

  return (
    <>
      <CounterPhoneCountsClient sections={sections} />
      <span hidden data-perf-ready="/m/operations/inventory/counts" />
    </>
  )
}
