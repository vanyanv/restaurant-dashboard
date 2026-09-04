import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getStoresSectionPromises } from "@/lib/counter/adapters/stores"
import { CounterPhoneStoresClient } from "./counter-phone-stores-client"

export const dynamic = "force-dynamic"

/** Stores, on a phone — `P.stores.phone()`. */
export default async function MobileStoresPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const sections = getStoresSectionPromises({ accountId: session.user.accountId })
  // The selected store, for the bar's middle tab. Read straight off `?store=`
  // rather than through `readCounterParams`: this page is `nodate`, so there
  // is no window to parse and nothing else in the query it needs.
  const sp = await searchParams
  const storeId = typeof sp.store === "string" ? sp.store : null

  return (
    <>
      <CounterPhoneStoresClient sections={sections} storeId={storeId} />
      <span hidden data-perf-ready="/m/stores" />
    </>
  )
}
