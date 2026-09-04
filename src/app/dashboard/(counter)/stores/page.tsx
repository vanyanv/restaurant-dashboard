import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getStoresSectionPromises } from "@/lib/counter/adapters/stores"
import { CounterStoresClient } from "./counter-stores-client"

export const dynamic = "force-dynamic"

/**
 * Stores — `P.stores` (`docs/counter/counter-prototype.html`).
 *
 * `nodate: true`: a store file is a set of standing inputs, not a period, so
 * this route reads no date control and passes none.
 */
export default async function StoresPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const sections = getStoresSectionPromises({ accountId: session.user.accountId })

  // The selected store, for the bar's middle tab. Straight off `?store=`:
  // `P.stores` is `nodate`, so there is no window to parse.
  const sp = await searchParams
  const storeId = typeof sp.store === "string" ? sp.store : null

  return (
    <>
      <CounterStoresClient sections={sections} storeId={storeId} />
      <span hidden data-perf-ready="/dashboard/stores" />
    </>
  )
}
