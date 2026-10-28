import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { readCounterParams } from "@/lib/counter/url-state"
import { getMenuItemsSectionPromises } from "@/lib/counter/adapters/menu-items"
import { getOverviewStores } from "@/lib/counter/adapters/overview"
import { counterToday } from "@/lib/counter/today"
import { CounterMenuItemsClient } from "./counter-menu-items-client"

export const dynamic = "force-dynamic"

/** Menu items — the owner's menu as dishes, with photos, plate cost and what needs fixing. */
export default async function MenuItemsPage({
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

  // A menu is judged over a month, not a day: one day hides a dish that sells
  // twice a week, and the New menu item screen looks back 30 days too.
  if (!params.has("range") && !params.has("from")) params.set("range", "d30")

  const today = counterToday()
  const counterParams = readCounterParams(params, today)

  // NOT AWAITED: the one section streams in behind its own Suspense boundary.
  const sections = getMenuItemsSectionPromises({
    range: counterParams.range,
    storeId: counterParams.storeId,
    accountId: session.user.accountId,
  })
  const stores = await getOverviewStores()

  return (
    <>
      <CounterMenuItemsClient params={params.toString()} stores={stores} today={today} sections={sections} />
      <span hidden data-perf-ready="/dashboard/menu/items" />
    </>
  )
}
