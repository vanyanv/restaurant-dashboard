import { getServerSession } from "next-auth"
import { notFound, redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { readCounterParams, writeCounterParams } from "@/lib/counter/url-state"
import { getStoreAnalyticsSectionPromises } from "@/lib/counter/adapters/analytics"
import { getOverviewStores } from "@/lib/counter/adapters/overview"
import { CounterStoreAnalyticsClient } from "./counter-store-analytics-client"

/**
 * Counter Analytics for ONE store — the sibling of `../page.tsx`.
 *
 * Everything above the day book is the group page filtered to this store, and
 * is deliberately the same call: `getStoreAnalyticsSectionPromises` shares
 * `buildMix`, `buildService` and the one `loadStatement` with
 * `getAnalyticsSectionPromises`, so `/dashboard/analytics?store=<id>` and this
 * route cannot print two marketplace shares for one window.
 *
 * What this route adds — and its whole argument for existing — is the day
 * book, the statement and the category table. The group page has no room to
 * draw those three times over.
 *
 * A page resolves the session, reads the URL params ONCE, calls exactly one
 * adapter and hands plain serialisable props to a client island. It never
 * imports Prisma or an action directly and never inspects `SectionData.status`
 * — `npm run tokens` fails the build on each.
 *
 * ## The scope is the PATH, and `?store=` is what the rail writes
 *
 * Every other Counter page is scoped by `?store=`; this one is scoped by its
 * path segment. The rail's store switcher lives in `(counter)/layout.tsx` and
 * knows only the first form — `AppShell` pushes `{ storeId }` onto
 * `storeScopeHref(pathname)`, which on this route is this route — so picking a
 * store in the rail arrives here as `/dashboard/analytics/<A>?store=<B>`: two
 * statements of scope, disagreeing.
 *
 * It is resolved HERE, on the server, in `?store=`'s favour, by redirecting to
 * that store's own path with the window carried over. The alternative — having
 * the page read `?store=` and render B's figures under A's URL — would make
 * every link a reader copies off this page a link to the wrong store. The
 * alternative in the other direction, teaching `storeScopeHref` to send the
 * switcher to `/dashboard/analytics`, would mean picking a store from a store
 * page drops you on the group page and loses the three sections you came for.
 *
 * "All stores" (a `storeId: null` push) deletes the key and so cannot be
 * distinguished here from a plain visit; the way back to every store is the
 * rail's own Analytics item, which is the group page.
 *
 * ## The 404, and the refusal that is NOT a 404
 *
 * A store id this account does not own is `notFound()` — the same answer
 * `/dashboard/orders/<id>` gives an order that is not the reader's, decided
 * off the switcher's own list so the rail cannot offer a store this page would
 * 404 on.
 *
 * A store that EXISTS but that the rollup has no row for is a different fact
 * and is not a 404: `loadStatement` publishes `storeNotFound`, the adapter's
 * `scopeEmptyReason` reads it FIRST, and every section resolves empty. The
 * page refuses per section rather than quietly answering for the whole
 * account. A `pre_open` store is the third case again — `empty("pre_open")`,
 * "Not trading yet", which is a fact about the store and not a fault.
 */
export default async function StoreAnalyticsPage({
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

  // The rail wrote a store into the query string (see the note above). The
  // path is what scopes this page, so send the reader to the path that means
  // what they just asked for, carrying the window with them.
  const railStoreId = query.get("store")
  if (railStoreId !== null && railStoreId !== "" && railStoreId !== storeId) {
    const rest = writeCounterParams(query, { storeId: null }).toString()
    const href = `/dashboard/analytics/${encodeURIComponent(railStoreId)}`
    redirect(rest ? `${href}?${rest}` : href)
  }

  // Resolved once, here, and passed to both the params reader and the client
  // island — a moving `new Date()` re-evaluated in two places could disagree
  // about which calendar day "today" is.
  const today = new Date()
  const counterParams = readCounterParams(query, today)

  // The switcher's list, started before the sections rather than awaited in
  // front of them: neither depends on the other, and this page must have the
  // list resolved to decide the 404 below. `getOverviewStores` is `cache()`d,
  // so the layout's copy and this one are one query per request.
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
    <CounterStoreAnalyticsClient
      // PLAIN TEXT, not the URLSearchParams above: a class instance crosses the
      // RSC boundary with its prototype stripped. See the island's own note.
      params={query.toString()}
      storeId={storeId}
      stores={stores}
      today={today}
      sections={sections}
    />
  )
}
