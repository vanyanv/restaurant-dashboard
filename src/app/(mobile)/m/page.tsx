import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { readCounterParams } from "@/lib/counter/url-state"
import { getOverviewSections, getOverviewStores } from "@/lib/counter/adapters/overview"
import { CounterPhoneOverviewClient } from "./counter-phone-overview-client"

export const dynamic = "force-dynamic"

/**
 * Counter Overview — the phone.
 *
 * `src/middleware.ts` redirects `/dashboard` to `/m` on a phone user agent, so
 * this route IS the phone surface: it is what a reader on a phone gets when
 * they open the dashboard, and it is what `npm run fidelity`'s `fidelity-mobile`
 * project measures against `P.overview.phone()`.
 *
 * It is a near-copy of `src/app/dashboard/page.tsx` on purpose, and the part
 * that must stay identical is the middle: ONE `getOverviewSections` call, with
 * the range, comparison and store read off the same `readCounterParams`. Two
 * surfaces asking two different loaders for "net sales" is how the same
 * restaurant ends up with two answers for the same day; here they cannot,
 * because there is one adapter and it is this one.
 *
 * ## What this replaced
 *
 * The editorial mobile home: `PageHead` + `MastheadFigures` + `HourlyChart` +
 * `DailyRevenueChart`, driven by `getMobileHomeSnapshot` and a `?period=`
 * vocabulary of its own. That page answered two figures where the design shows
 * a dozen, and — the reason it could not simply be kept alongside — it read a
 * different range parameter than the desk, so a phone and a desk open on the
 * same account showed different windows and neither said so. Its loaders are
 * left in place; other `/m` pages still use them.
 *
 * ## The owner gate, and why it redirects rather than degrades
 *
 * Ruling C-R4, unchanged on this surface: `getAllStoresPnL` refuses a
 * non-owner and most of this page's sections share that one rollup, so a
 * reader without owner access would get a page of "restricted to owners"
 * boxes. It redirects to `/m/more` — the phone's settings — rather than
 * `/dashboard/settings`, which on a phone would bounce through the middleware
 * to the same place with an extra hop.
 */
export default async function MobileHomePage({
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

  // Resolved once, here, and passed to the island — a moving `new Date()`
  // re-evaluated in two places could disagree about which calendar day
  // "today" is.
  const today = new Date()
  const counterParams = readCounterParams(params, today)

  const stores = await getOverviewStores()
  const sections = await getOverviewSections({
    range: counterParams.range,
    comparisonId: counterParams.comparisonId,
    storeId: counterParams.storeId,
    accountId: session.user.accountId,
  })

  return (
    <div data-perf-ready="/m">
      <CounterPhoneOverviewClient
        params={params.toString()}
        stores={stores}
        today={today}
        sections={sections}
      />
    </div>
  )
}
