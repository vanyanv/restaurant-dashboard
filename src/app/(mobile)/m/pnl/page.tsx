import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { readCounterParams } from "@/lib/counter/url-state"
import { getPnlSections } from "@/lib/counter/adapters/pnl"
import { getOverviewStores } from "@/lib/counter/adapters/overview"
import { CounterPhonePnlClient } from "./counter-phone-pnl-client"

export const dynamic = "force-dynamic"

/**
 * Counter P&L — the phone (Phase C, page 2, surface 2).
 *
 * `src/middleware.ts` rewrites `/dashboard/pnl` to `/m/pnl` on a phone user
 * agent, so this route IS the phone surface of the P&L, and it is what
 * `npm run fidelity`'s `fidelity-mobile` project measures against
 * `P.pnl.phone()`.
 *
 * It is a near-copy of `src/app/dashboard/pnl/page.tsx` on purpose, and the
 * part that must stay identical is the middle: ONE `getPnlSections` call, with
 * the range, comparison and store read off the same `readCounterParams`. Two
 * surfaces asking two different loaders for "the bottom line" is how one
 * restaurant ends up with two answers for one range; here they cannot,
 * because there is one adapter and it is this one.
 *
 * ## The owner gate, and why it redirects rather than degrades
 *
 * Ruling C-R4, the same on both surfaces: `getAllStoresPnL` refuses a
 * non-owner and every section on this page is that one rollup, so a reader
 * without owner access would get a page of "restricted to owners" boxes. It
 * redirects to `/m/more` — the phone's settings — rather than
 * `/dashboard/settings`, which on a phone bounces back through the middleware
 * for an extra hop.
 */
export default async function MobilePnlPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (!hasOwnerAccess(session.user.role)) redirect("/m/more")

  const sp = await searchParams
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === "string") params.set(key, value)
  }

  // Resolved once, here, and passed to both the params reader and the island —
  // a moving `new Date()` re-evaluated in two places could disagree about
  // which calendar day "today" is, and the weeks are anchored on today rather
  // than on the range (note 53).
  const today = new Date()
  const counterParams = readCounterParams(params, today)

  // The switcher's list, shared with the Overview rather than re-queried, so
  // the phone's store sheet cannot offer a store the desk's rail does not.
  const stores = await getOverviewStores()
  const sections = await getPnlSections({
    range: counterParams.range,
    comparisonId: counterParams.comparisonId,
    storeId: counterParams.storeId,
    accountId: session.user.accountId,
    today,
  })

  return (
    <div data-perf-ready="/m/pnl">
      <CounterPhonePnlClient
        // PLAIN TEXT, not the URLSearchParams above: a class instance crosses
        // the RSC boundary with its prototype stripped.
        params={params.toString()}
        stores={stores}
        today={today}
        sections={sections}
      />
    </div>
  )
}
