import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getNewStoreSectionPromises } from "@/lib/counter/adapters/new-store"
import { CounterNewStoreClient } from "./counter-new-store-client"

export const dynamic = "force-dynamic"

/**
 * New store — `P.newstore`.
 *
 * No owner gate here. The editorial page called `hasOwnerAccess` and
 * redirected on failure; `Role` holds only OWNER and DEVELOPER and the helper
 * accepts both, so the branch was unreachable. `createStore` still checks it
 * server-side, which is where a gate that matters belongs.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const sections = getNewStoreSectionPromises({ accountId: session.user.accountId })

  // `?store=` only, for the bar's middle tab — this page is `nodate`.
  const sp = await searchParams
  const storeId = typeof sp.store === "string" ? sp.store : null

  return (
    <>
      <CounterNewStoreClient sections={sections} storeId={storeId} />
      <span hidden data-perf-ready="/dashboard/stores/new" />
    </>
  )
}
