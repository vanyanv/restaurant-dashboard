import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { readCounterParams } from "@/lib/counter/url-state"
import { getInventorySectionPromises } from "@/lib/counter/adapters/inventory"
import { getOverviewStores } from "@/lib/counter/adapters/overview"
import { CounterInventoryClient } from "./counter-inventory-client"

export const dynamic = "force-dynamic"

/** Inventory — `P.inventory` (`docs/counter/counter-prototype.html:5730`). */
export default async function InventoryPage({
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

  const sections = getInventorySectionPromises({
    storeId: counterParams.storeId,
    accountId: session.user.accountId,
    today,
  })

  return (
    <>
      <CounterInventoryClient
        params={params.toString()}
        stores={stores}
        today={today}
        sections={sections}
      />
      <span hidden data-perf-ready="/dashboard/operations/inventory" />
    </>
  )
}
