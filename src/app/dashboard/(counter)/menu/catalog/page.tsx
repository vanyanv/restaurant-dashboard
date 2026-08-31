import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { readCounterParams } from "@/lib/counter/url-state"
import { getMenuCatalogSectionPromises } from "@/lib/counter/adapters/menu-catalog"
import { getOverviewStores } from "@/lib/counter/adapters/overview"
import { CounterCatalogClient } from "./counter-catalog-client"
import { counterToday } from "@/lib/counter/today"

export const dynamic = "force-dynamic"

/**
 * The menu catalog — `P.catalog` (`docs/counter/counter-prototype.html:6059`).
 *
 * Not awaited: `getMenuCatalogSectionPromises` hands four promises to the
 * client and each section resolves into its own Suspense boundary.
 */
export default async function CatalogPage({
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

  const today = counterToday()
  const counterParams = readCounterParams(params, today)
  const stores = await getOverviewStores()

  const sections = getMenuCatalogSectionPromises({
    range: counterParams.range,
    storeId: counterParams.storeId,
    accountId: session.user.accountId,
  })

  return (
    <>
      <CounterCatalogClient
        params={params.toString()}
        stores={stores}
        today={today}
        sections={sections}
      />
      <span hidden data-perf-ready="/dashboard/menu/catalog" />
    </>
  )
}
