import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { readCounterParams } from "@/lib/counter/url-state"
import { getPnlSectionPromises } from "@/lib/counter/adapters/pnl"
import { getStoreFixedSectionPromises } from "@/lib/counter/adapters/pnl-store"
import { getOverviewStores } from "@/lib/counter/adapters/overview"
import { CounterPnlClient } from "./counter-pnl-client"
import { counterToday } from "@/lib/counter/today"

/**
 * Counter P&L — the second Counter page (Phase C, page 2).
 *
 * The route GRADUATED out of `(editorial)` to get here: a page rebuilt on
 * Counter moves out of that route group, which is both the migration mechanism
 * and the way anyone sees what is left (`ls src/app/dashboard/(editorial)`).
 *
 * A page resolves the session, reads the URL params ONCE, calls exactly one
 * adapter and hands plain serialisable props to a client island. It never
 * imports Prisma or an action directly and never inspects `SectionData.status`
 * — `npm run tokens` fails the build on either.
 */
export default async function PnlPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  /*
   * Owner-only, the same gate the editorial P&L carried and the same gate the
   * Overview carries.
   *
   * `getAllStoresPnL` refuses a non-owner, and every section on this page is
   * that one rollup — so a reader without owner access would land on a page
   * whose strip, cascade, eight weeks, statement and store table ALL read
   * "P&L is restricted to owners". A page that looks broken is worse than one
   * that was never theirs. `hasOwnerAccess` is OWNER or DEVELOPER.
   */
  if (!hasOwnerAccess(session.user.role)) redirect("/dashboard/settings")

  const sp = await searchParams
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === "string") params.set(key, value)
  }

  // Resolved once, here, and passed to both the params reader and the client
  // island — a moving `new Date()` re-evaluated in two places could disagree
  // about which calendar day "today" is, and the eight weeks are anchored on
  // today rather than on the range (note 53).
  const today = counterToday()
  const counterParams = readCounterParams(params, today)

  // NOT AWAITED — one promise per section, each unwrapped inside its own
  // Suspense boundary by `Section`, so the strip and the statement no longer
  // sit behind the eight trailing weeks. Started before the store list so the
  // two are concurrent.
  const sections = getPnlSectionPromises({
    range: counterParams.range,
    comparisonId: counterParams.comparisonId,
    storeId: counterParams.storeId,
    accountId: session.user.accountId,
    today,
  })

  /*
   * `P.pnlstore`'s two store-only sections — the fixed costs this store
   * carries, and the stores excluded from the statement.
   *
   * Started only when a store is SELECTED, because that is what they are
   * about. `P.pnlstore` is a separate page in the prototype and deliberately
   * is not one here: `src/app/dashboard/pnl/[storeId]/page.tsx` redirects onto
   * `?store=<id>` and its own comment argues why a store is a param on one
   * P&L rather than a second composition. The content lands; the route does
   * not.
   */
  const storeSections = counterParams.storeId
    ? getStoreFixedSectionPromises({
        range: counterParams.range,
        comparisonId: counterParams.comparisonId,
        storeId: counterParams.storeId,
        accountId: session.user.accountId,
        today,
      })
    : null

  // The switcher's list. Shared with the Overview rather than re-queried, so
  // the rail cannot offer one page a store the other does not have.
  const stores = await getOverviewStores()

  return (
    <CounterPnlClient
      storeSections={storeSections}
      // PLAIN TEXT, not the URLSearchParams above: a class instance crosses the
      // RSC boundary with its prototype stripped. See the island's own note.
      params={params.toString()}
      stores={stores}
      today={today}
      sections={sections}
    />
  )
}
