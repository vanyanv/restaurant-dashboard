import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { readCounterParams } from "@/lib/counter/url-state"
import { getProductMixSectionPromises } from "@/lib/counter/adapters/product-mix"
import { CounterPhoneProductMixClient } from "./counter-phone-product-mix-client"

export const dynamic = "force-dynamic"

/**
 * Product mix, on a phone — `P.productmix.phone()`
 * (`docs/counter/counter-prototype.html:6294`).
 *
 * Calls `getProductMixSectionPromises`, the same function the desk calls.
 */
export default async function MobileProductMixPage({
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

  const sections = getProductMixSectionPromises({
    range: counterParams.range,
    storeId: counterParams.storeId,
    accountId: session.user.accountId,
  })

  return (
    <>
      <CounterPhoneProductMixClient
        params={params.toString()}
        today={today}
        sections={sections}
      />
      <span hidden data-perf-ready="/m/product-mix" />
    </>
  )
}
