import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { readCounterParams } from "@/lib/counter/url-state"
import { getMenuProfitSectionPromises } from "@/lib/counter/adapters/menu-profit"
import { getOverviewStores } from "@/lib/counter/adapters/overview"
import { CounterMenuProfitClient } from "./counter-menu-profit-client"

/**
 * Menu profit — `P.menu` (`docs/counter/counter-prototype.html:5441`).
 *
 * Volume against margin, the four quadrants, and an honest account of what the
 * figures did not see. The Menu hub's third destination.
 *
 * Owner-gated: Revenue and Food cost are the statement's own lines, which
 * `getAllStoresPnL` refuses a non-owner, and the contribution column is money
 * throughout. There is nothing left over for a reader without owner access.
 */
export default async function MenuProfitPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (!hasOwnerAccess(session.user.role)) redirect("/dashboard/menu")

  const sp = await searchParams
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === "string") params.set(key, value)
  }

  const today = new Date()
  const counterParams = readCounterParams(params, today)

  // NOT AWAITED — one promise per section, each unwrapped inside its own
  // Suspense boundary. All five share ONE `getMenuEngineering` + `loadStatement`
  // pair, so the matrix does not pay for the ledger's sort.
  const sections = getMenuProfitSectionPromises({
    range: counterParams.range,
    storeId: counterParams.storeId,
    accountId: session.user.accountId,
  })

  const stores = await getOverviewStores()

  return (
    <CounterMenuProfitClient
      params={params.toString()}
      stores={stores}
      today={today}
      sections={sections}
    />
  )
}
