import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { readCounterParams } from "@/lib/counter/url-state"
import { getOverviewSections, getOverviewStores } from "@/lib/counter/adapters/overview"
import { CounterOverviewClient } from "./counter-overview-client"

/**
 * Counter Overview — the first Counter page (Plan 7). A page composes
 * primitives and calls exactly one adapter; it never imports Prisma or an
 * action directly and never inspects `SectionData.status` — `npm run
 * tokens` fails the build on either. See DESIGN.md's Pages section.
 */
export default async function DashboardPage({
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

  // Resolved once, here, and passed to both the params reader and the client
  // island — a moving `new Date()` re-evaluated in two places could disagree
  // about which calendar day "today" is.
  const today = new Date()
  const counterParams = readCounterParams(params, today)

  // Stores load first — cheap, and getOverviewSections reuses the result to
  // resolve the selected store's display name for the single-store ledger
  // row (getCogsKpis returns none of its own) rather than issuing a second
  // query for it.
  const stores = await getOverviewStores()
  const sections = await getOverviewSections({
    range: counterParams.range,
    storeId: counterParams.storeId,
    accountId: session.user.accountId,
    stores,
  })

  return (
    <CounterOverviewClient
      pathname="/dashboard"
      params={params}
      stores={stores}
      today={today}
      sections={sections}
    />
  )
}
