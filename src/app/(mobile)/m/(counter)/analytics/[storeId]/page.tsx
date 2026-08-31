import { getServerSession } from "next-auth"
import { notFound, redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { readCounterParams, writeCounterParams } from "@/lib/counter/url-state"
import { getStoreAnalyticsSectionPromises } from "@/lib/counter/adapters/analytics"
import { getOverviewStores } from "@/lib/counter/adapters/overview"
import { CounterPhoneStoreAnalyticsClient } from "./counter-phone-store-analytics-client"
import { counterToday } from "@/lib/counter/today"

/**
 * One store's Analytics — the phone. Sibling of
 * `src/app/dashboard/(counter)/analytics/[storeId]/page.tsx`, and it is
 * deliberately the same call: `getStoreAnalyticsSectionPromises` shares
 * `buildMix`, `buildService` and `loadStatement` with the group page's own
 * loader, so `/dashboard/analytics/<id>` and this route cannot print two
 * different net sales figures for one window.
 *
 * `P.analyticsstore.phone()` (`docs/counter/counter-prototype.html:7648`) is a
 * small composition — a two-cell strip, one chart and a four-row day book —
 * and that is deliberate, not a partial port: the desk page's own statement,
 * category table, channel mix and top items do not belong on a phone (mobile
 * is a lean glance-and-do tool, not the desk squeezed).
 *
 * ## The scope is the PATH, same reconciliation as the desk sibling
 *
 * `PhoneShell`'s store sheet (`.mtop`'s `.st`) writes `?store=<id>` through
 * `onSelectStore`, and `storeScopeHref` sends it back to THIS SAME pathname
 * for any route that is not a record route (`route-shape.ts`) — so picking a
 * store from the sheet while already on `/m/analytics/<A>` arrives here as
 * `/m/analytics/<A>?store=<B>`: two statements of scope, disagreeing, exactly
 * the case the desk page's own docblock resolves. It is resolved the same
 * way, in `?store=`'s favour, by redirecting to that store's own path with
 * the window carried over — the alternative would make every link a reader
 * copies off this page a link to the wrong store.
 *
 * ## The 404, and the refusal that is NOT a 404
 *
 * A store id this account does not own is `notFound()`, decided off the same
 * `getOverviewStores()` list `(counter)/layout.tsx` already fetched (it is
 * `cache()`d, so this is one query per request, not two). A store that EXISTS
 * but that the rollup has no row for, or that is `pre_open`, is a different
 * fact and is not a 404 — every section below refuses on its own, per
 * `scopeEmptyReason`.
 */
export default async function MobileStoreAnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ storeId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const { storeId } = await params

  const sp = await searchParams
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === "string") query.set(key, value)
  }

  // The phone's store sheet wrote a store into the query string (see the note
  // above). The path is what scopes this page, so send the reader to the
  // path that means what they just asked for, carrying the window with them.
  const railStoreId = query.get("store")
  if (railStoreId !== null && railStoreId !== "" && railStoreId !== storeId) {
    const rest = writeCounterParams(query, { storeId: null }).toString()
    const href = `/m/analytics/${encodeURIComponent(railStoreId)}`
    redirect(rest ? `${href}?${rest}` : href)
  }

  // Resolved once, here, and passed to both the params reader and the client
  // island — a moving `new Date()` re-evaluated in two places could disagree
  // about which calendar day "today" is.
  const today = counterToday()
  const counterParams = readCounterParams(query, today)

  // The same cached list `(counter)/layout.tsx` already fetched for the
  // store sheet — started before the sections rather than awaited in front
  // of them, since neither depends on the other and this page must have the
  // list resolved to decide the 404 below.
  const storesP = getOverviewStores()

  // NOT AWAITED — one promise per section, each unwrapped inside its own
  // Suspense boundary by `Section`, so the day book is not held up by the
  // hourly table or by the menu-profit walk.
  const sections = getStoreAnalyticsSectionPromises({
    range: counterParams.range,
    comparisonId: counterParams.comparisonId,
    // The PATH's store, never `counterParams.storeId` — the query string has
    // already been reconciled above.
    storeId,
    accountId: session.user.accountId,
  })

  const stores = await storesP
  if (!stores.some((s) => s.id === storeId)) notFound()

  return (
    <CounterPhoneStoreAnalyticsClient
      // PLAIN TEXT, not the URLSearchParams above: a class instance crosses
      // the RSC boundary with its prototype stripped.
      params={query.toString()}
      storeId={storeId}
      stores={stores}
      today={today}
      sections={sections}
    />
  )
}
