import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { readCounterParams } from "@/lib/counter/url-state"
import { getMenuCatalogSectionPromises } from "@/lib/counter/adapters/menu-catalog"
import { CounterPhoneCatalogClient } from "./counter-phone-catalog-client"

export const dynamic = "force-dynamic"

/**
 * The menu catalog, on a phone — `P.catalog.phone()`
 * (`docs/counter/counter-prototype.html:6090`).
 *
 * Calls `getMenuCatalogSectionPromises`, the same function the desk calls.
 */
export default async function MobileCatalogPage({
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

  const sections = getMenuCatalogSectionPromises({
    range: counterParams.range,
    storeId: counterParams.storeId,
    accountId: session.user.accountId,
  })

  return (
    <>
      <CounterPhoneCatalogClient
        params={params.toString()}
        today={today}
        sections={sections}
      />
      <span hidden data-perf-ready="/m/menu/catalog" />
    </>
  )
}
