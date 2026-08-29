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
export default async function Page() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const sections = getNewStoreSectionPromises({ accountId: session.user.accountId })

  return (
    <>
      <CounterNewStoreClient sections={sections} />
      <span hidden data-perf-ready="/dashboard/stores/new" />
    </>
  )
}
