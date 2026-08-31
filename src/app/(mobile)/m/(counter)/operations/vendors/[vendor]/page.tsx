import { getServerSession } from "next-auth"
import { notFound, redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { readCounterParams } from "@/lib/counter/url-state"
import { getVendorName, getVendorSectionPromises } from "@/lib/counter/adapters/vendor"
import { CounterPhoneVendorClient } from "./counter-phone-vendor-client"
import { counterToday } from "@/lib/counter/today"

export const dynamic = "force-dynamic"

/** One vendor, on a phone — `P.vendor.phone()`. */
export default async function MobileVendorPage({
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

  const named = await getVendorName(name, session.user.accountId)
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
      <CounterPhoneVendorClient title={named.name} sections={sections} />
      <span hidden data-perf-ready="/m/operations/vendors/[vendor]" />
    </>
  )
}
