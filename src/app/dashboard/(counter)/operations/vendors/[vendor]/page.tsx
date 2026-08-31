import { getServerSession } from "next-auth"
import { notFound, redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { readCounterParams } from "@/lib/counter/url-state"
import { getVendorName, getVendorSectionPromises } from "@/lib/counter/adapters/vendor"
import { getOverviewStores } from "@/lib/counter/adapters/overview"
import { CounterVendorClient } from "./counter-vendor-client"
import { counterToday } from "@/lib/counter/today"

export const dynamic = "force-dynamic"

/**
 * One vendor — `P.vendor` (`docs/counter/counter-prototype.html`).
 *
 * The segment is the NORMALIZED display name, URL-encoded. There is no
 * `Vendor` table to carry an id — see the adapter's docblock.
 */
export default async function VendorPage({
  params,
  searchParams,
}: {
  params: Promise<{ vendor: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const { vendor } = await params
  const name = decodeURIComponent(vendor)
  const sp = await searchParams
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === "string") qs.set(key, value)
  }

  const today = counterToday()
  const counterParams = readCounterParams(qs, today)

  const [stores, named] = await Promise.all([
    getOverviewStores(),
    getVendorName(name, session.user.accountId),
  ])
  if (!named) notFound()

  const sections = getVendorSectionPromises({
    vendor: name,
    storeId: counterParams.storeId,
    accountId: session.user.accountId,
    range: counterParams.range,
    today,
  })

  return (
    <>
      <CounterVendorClient
        params={qs.toString()}
        stores={stores}
        today={today}
        title={named.name}
        sections={sections}
      />
      <span hidden data-perf-ready="/dashboard/operations/vendors/[vendor]" />
    </>
  )
}
