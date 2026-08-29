import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getNewCountSectionPromises } from "@/lib/counter/adapters/new-count"
import { getOverviewStores } from "@/lib/counter/adapters/overview"
import { CounterNewCountClient } from "./counter-new-count-client"

export const dynamic = "force-dynamic"

/**
 * Start a count — `P.newcount`.
 *
 * No owner gate. The editorial page called `hasOwnerAccess(session.user.role)`
 * and redirected on failure; `Role` holds only OWNER and DEVELOPER and the
 * helper accepts both, so that branch was unreachable. A gate that cannot
 * fail is not a gate.
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
  // The store the button acts on, resolved here so the page's sentence and its
  // button can never name different stores.
  const targetStoreId =
    storeId ?? stores.find((s) => s.stage === "trading")?.id ?? stores[0]?.id ?? null
  const sections = getNewCountSectionPromises({ storeId, targetStoreId })

  return (
    <>
      <CounterNewCountClient sections={sections} targetStoreId={targetStoreId} />
      <span hidden data-perf-ready="/dashboard/operations/inventory/count/new" />
    </>
  )
}
