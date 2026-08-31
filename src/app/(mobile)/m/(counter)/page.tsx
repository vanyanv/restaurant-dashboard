import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { readCounterParams } from "@/lib/counter/url-state"
import { getOverviewSectionPromises, getOverviewStores } from "@/lib/counter/adapters/overview"
import { CounterPhoneOverviewClient } from "./counter-phone-overview-client"
import { counterToday } from "@/lib/counter/today"

export const dynamic = "force-dynamic"

/**
 * Counter Overview — the phone.
 *
 * `src/proxy.ts` redirects `/dashboard` to `/m` on a phone user agent, so
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
  const today = counterToday()
  const counterParams = readCounterParams(params, today)

  // NOT AWAITED — one promise per section, each unwrapped inside its own
  // Suspense boundary by `Section`. See the desk page's note. Started before
  // the store list so the two are concurrent.
  const sections = getOverviewSectionPromises({
    range: counterParams.range,
    comparisonId: counterParams.comparisonId,
    storeId: counterParams.storeId,
    accountId: session.user.accountId,
  })

  const stores = await getOverviewStores()

  return (
    <>
      <CounterPhoneOverviewClient
        params={params.toString()}
        stores={stores}
        today={today}
        sections={sections}
      />
      {/*
       * The perf harness's marker (`scripts/mobile-transition-perf.ts`), which
       * used to be a `<div>` WRAPPING the island. The island no longer brings
       * its own `.mscroll` — that is the `(counter)` layout's now — so a
       * wrapper here would land INSIDE `.mscroll`, whose `display:grid` +
       * `gap:11px` and `> *:nth-child()` entry delays are written against the
       * page's blocks being its direct children. `hidden` keeps it out of the
       * grid entirely (`display:none` is not a grid item), and LAST keeps
       * every existing block's `nth-child` index where it was.
       */}
      <span hidden data-perf-ready="/m" />
    </>
  )
}
