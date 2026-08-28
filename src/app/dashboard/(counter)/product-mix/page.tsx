import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { readCounterParams } from "@/lib/counter/url-state"
import { getProductMixSectionPromises } from "@/lib/counter/adapters/product-mix"
import { getOverviewStores } from "@/lib/counter/adapters/overview"
import { CounterProductMixClient } from "./counter-product-mix-client"

export const dynamic = "force-dynamic"

/** Product mix — `P.productmix` (`docs/counter/counter-prototype.html:6263`). */
export default async function ProductMixPage({
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
  const stores = await getOverviewStores()

  const sections = getProductMixSectionPromises({
    range: counterParams.range,
    storeId: counterParams.storeId,
    accountId: session.user.accountId,
  })

  return (
    <>
      <CounterProductMixClient
        params={params.toString()}
        stores={stores}
        today={today}
        sections={sections}
      />
      <span hidden data-perf-ready="/dashboard/product-mix" />
    </>
  )
}
