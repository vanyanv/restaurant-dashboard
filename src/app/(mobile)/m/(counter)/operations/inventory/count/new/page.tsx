import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getNewCountSectionPromises } from "@/lib/counter/adapters/new-count"
import { getOverviewStores } from "@/lib/counter/adapters/overview"
import { CounterPhoneNewCountClient } from "./counter-phone-new-count-client"

export const dynamic = "force-dynamic"

/**
 * Start a count, on a phone — `P.countnew.phone()`.
 *
 * The store is resolved here for the same reason the desk page resolves it:
 * the sentence and the button must never name different stores.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const sp = await searchParams
  const storeId = typeof sp.storeId === "string" ? sp.storeId : null

  const stores = await getOverviewStores()
  const targetStoreId =
    storeId ?? stores.find((s) => s.stage === "trading")?.id ?? stores[0]?.id ?? null
  const sections = getNewCountSectionPromises({ storeId, targetStoreId })

  return (
    <>
      <CounterPhoneNewCountClient sections={sections} targetStoreId={targetStoreId} />
      <span hidden data-perf-ready="/m/operations/inventory/count/new" />
    </>
  )
}
