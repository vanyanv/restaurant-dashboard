import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { readCounterParams } from "@/lib/counter/url-state"
import { getAnalyticsSectionPromises } from "@/lib/counter/adapters/analytics"
import { CounterPhoneAnalyticsClient } from "./counter-phone-analytics-client"

export const dynamic = "force-dynamic"

/**
 * Counter Analytics — the group page, on a phone.
 *
 * `src/middleware.ts` rewrites `/dashboard/analytics` to `/m/analytics` on a
 * phone user agent, so this route IS the phone surface, and it is what
 * `npm run fidelity`'s `fidelity-mobile` project measures against
 * `P.analytics.phone()`.
 *
 * It is a near-copy of `src/app/dashboard/(counter)/analytics/page.tsx` on
 * purpose, and the part that must stay identical is the middle: ONE
 * `getAnalyticsSectionPromises` call, with the range, comparison and store
 * read off the same `readCounterParams`. Two surfaces asking two different
 * loaders for "where the sales came from" is how one restaurant ends up with
 * two answers for one range; here they cannot, because there is one adapter
 * and it is this one.
 *
 * ## No owner gate here, same reasoning as the desk page
 *
 * The desk page's own note explains why it does not redirect a non-owner
 * away: `Role` is `OWNER | DEVELOPER` only and `hasOwnerAccess` accepts both,
 * so no signed-in reader fails that check today, and none of this page's
 * sections are the all-stores P&L rollup that the P&L and the Overview gate
 * on. That reasoning is unchanged on this surface — this page reads the same
 * adapter — so it carries no gate either, beyond requiring a session at all.
 */
export default async function MobileAnalyticsPage({
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

  // Resolved once, here, and passed to both the params reader and the island —
  // a moving `new Date()` re-evaluated in two places could disagree about
  // which calendar day "today" is.
  const today = new Date()
  const counterParams = readCounterParams(params, today)

  // NOT AWAITED — one promise per section, each unwrapped inside its own
  // Suspense boundary by `Section`. See the desk page's own note.
  const sections = getAnalyticsSectionPromises({
    range: counterParams.range,
    comparisonId: counterParams.comparisonId,
    storeId: counterParams.storeId,
    accountId: session.user.accountId,
  })

  return (
    <>
      <CounterPhoneAnalyticsClient
        // PLAIN TEXT, not the URLSearchParams above: a class instance crosses
        // the RSC boundary with its prototype stripped.
        params={params.toString()}
        today={today}
        sections={sections}
      />
      {/*
       * The perf harness's marker (`scripts/mobile-transition-perf.ts`). See
       * `(mobile)/m/(counter)/pnl/page.tsx`'s own note on why this is a
       * hidden sibling and not a wrapper around the island.
       */}
      <span hidden data-perf-ready="/m/analytics" />
    </>
  )
}
