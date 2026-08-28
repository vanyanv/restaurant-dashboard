import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { readCounterParams } from "@/lib/counter/url-state"
import { getVendorsSectionPromises } from "@/lib/counter/adapters/vendors"
import { CounterPhoneVendorsClient } from "./counter-phone-vendors-client"

export const dynamic = "force-dynamic"

/**
 * Vendors, on a phone — `P.vendors.phone()`.
 *
 * Calls `getVendorsSectionPromises`, the same function the desk calls.
 */
export default async function MobileVendorsPage({
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

  const sections = getVendorsSectionPromises({
    storeId: counterParams.storeId,
    accountId: session.user.accountId,
    range: counterParams.range,
    today,
  })

  return (
    <>
      <CounterPhoneVendorsClient sections={sections} />
      <span hidden data-perf-ready="/m/operations/vendors" />
    </>
  )
}
