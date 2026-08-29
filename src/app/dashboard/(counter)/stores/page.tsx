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
export default async function StoresPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const sections = getStoresSectionPromises({ accountId: session.user.accountId })

  return (
    <>
      <CounterStoresClient sections={sections} />
      <span hidden data-perf-ready="/dashboard/stores" />
    </>
  )
}
