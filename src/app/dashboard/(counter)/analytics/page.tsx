import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { readCounterParams } from "@/lib/counter/url-state"
import { getAnalyticsSectionPromises } from "@/lib/counter/adapters/analytics"
import { getOverviewStores } from "@/lib/counter/adapters/overview"
import { CounterAnalyticsClient } from "./counter-analytics-client"

/**
 * Counter Analytics, the group page — where the sales came from, and when.
 *
 * The route GRADUATED out of `(editorial)` to get here, the same move the P&L
 * made: a page rebuilt on Counter leaves that route group, which is both the
 * migration mechanism and the way anyone sees what is left
 * (`ls src/app/dashboard/(editorial)`).
 *
 * A page resolves the session, reads the URL params ONCE, calls exactly one
 * adapter and hands plain serialisable props to a client island. It never
 * imports Prisma or an action directly and never inspects `SectionData.status`
 * — `npm run tokens` fails the build on either.
 *
 * ## Why there is no owner gate here, and the P&L has one
 *
 * `loadStatement` throws the rollup's refusal rather than returning zeroes
 * (`src/lib/counter/statement.ts`), so on an account without owner access
 * three of this page's four sections — the strip, the mix and the day of week
 * — would read "P&L is restricted to owners". The P&L and the Overview
 * redirect for exactly that reason, and the test the P&L's own note states is
 * that EVERY section would refuse.
 *
 * That test is not met here. "When the orders come" is `loadServiceProfile`,
 * which reads `OtterHourlySummary` directly and never touches
 * `getAllStoresPnL` — it is a whole reading, not a stub, and it is the one
 * panel on this page that is not a money figure. A reader sent to
 * `/dashboard/settings` would be sent away from the only section on the page
 * that was theirs.
 *
 * And the gate could not fire in any case: `Role` in `prisma/schema.prisma` is
 * `OWNER | DEVELOPER` and `hasOwnerAccess` accepts both, so no signed-in
 * reader fails it today. A redirect here would be a branch that has never run,
 * guarding a page whose refusal path is already a refusal the reader can see.
 */
export default async function AnalyticsPage({
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

  // NOT AWAITED — one promise per section, each unwrapped inside its own
  // Suspense boundary by `Section`, so the strip and the mix are not held up
  // by the hourly table (a separate query, and this page's slowest).
  const sections = getAnalyticsSectionPromises({
    range: counterParams.range,
    comparisonId: counterParams.comparisonId,
    storeId: counterParams.storeId,
    accountId: session.user.accountId,
  })

  // The switcher's list. Shared with the Overview rather than re-queried, so
  // the rail cannot offer one page a store the other does not have.
  const stores = await getOverviewStores()

  return (
    <CounterAnalyticsClient
      // PLAIN TEXT, not the URLSearchParams above: a class instance crosses the
      // RSC boundary with its prototype stripped. See the island's own note.
      params={params.toString()}
      stores={stores}
      today={today}
      sections={sections}
    />
  )
}
