import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { readCounterParams } from "@/lib/counter/url-state"
import { getOverviewSectionPromises, getOverviewStores } from "@/lib/counter/adapters/overview"
import { CounterOverviewClient } from "./counter-overview-client"
import { counterToday } from "@/lib/counter/today"

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
  /*
   * Owner-only, the same gate `/dashboard/pnl` already carries.
   *
   * `getAllStoresPnL` refuses a non-owner, and five of this page's sections
   * now share that one rollup — so a reader without owner access would land on
   * an Overview whose head figure, strip, moving band, chart and store cards
   * all read "P&L is restricted to owners". A page that looks broken is worse
   * than one that was never theirs. `hasOwnerAccess` is OWNER or DEVELOPER,
   * which is every role this application has.
   */
  if (!hasOwnerAccess(session.user.role)) redirect("/dashboard/settings")

  const sp = await searchParams
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === "string") params.set(key, value)
  }

  // Resolved once, here, and passed to both the params reader and the client
  // island — a moving `new Date()` re-evaluated in two places could disagree
  // about which calendar day "today" is.
  const today = counterToday()
  const counterParams = readCounterParams(params, today)

  /*
   * NOT AWAITED, and that is the whole of Task 3 on this page.
   *
   * `getOverviewSectionPromises` starts every load and returns one promise per
   * section. Each promise is handed to that section's own Suspense boundary
   * inside `Section`, so the strip paints when the rollup answers and does not
   * wait for the guest ratings, the alert inbox or the model's call. The page
   * itself never sees a resolved value and so still has nothing to branch on.
   *
   * Started BEFORE the store list is awaited, so the two are concurrent — the
   * sequential `await` pair here was defect 5 in the spec.
   */
  const sections = getOverviewSectionPromises({
    range: counterParams.range,
    // The comparison is part of the range (spec §5.3), so the adapter needs it
    // to load the second rollup the dashed line and every delta are read
    // against. Without it nothing on the page may claim a comparison.
    comparisonId: counterParams.comparisonId,
    storeId: counterParams.storeId,
    accountId: session.user.accountId,
  })

  // The rail's switcher is the LAYOUT's now; this list is for the page's own
  // content — the dispatch line's store lifecycle. `getOverviewStores` is
  // `cache()`d, so the layout's call and this one are one query per request.
  const stores = await getOverviewStores()

  return (
    <CounterOverviewClient
      params={params.toString()}
      stores={stores}
      today={today}
      sections={sections}
    />
  )
}
