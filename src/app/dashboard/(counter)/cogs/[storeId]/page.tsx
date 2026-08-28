import { getServerSession } from "next-auth"
import { notFound, redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { readCounterParams, writeCounterParams } from "@/lib/counter/url-state"
import { getStoreCogsSectionPromises } from "@/lib/counter/adapters/cogs"
import { getOverviewStores } from "@/lib/counter/adapters/overview"
import { CounterStoreCogsClient } from "./counter-store-cogs-client"

/**
 * Counter COGS for ONE store — the sibling of `../page.tsx`
 * (`P.cogsstore.desk`, `docs/counter/counter-prototype.html:7744`).
 *
 * The prototype's own note says what this route is for: *"the same cost page
 * for one store, against the COGS target that store carries on its own file
 * rather than the group average."* With one trading store the two pages read
 * alike today; the difference is which `targetCogsPct` the plan line comes
 * from, and that difference becomes real the moment Glendale or Van Nuys
 * opens with a target of its own.
 *
 * ## This commit finishes the editorial deletion
 *
 * `(editorial)/cogs/page.tsx` went with the group page. Its `components/`,
 * `error.tsx` and `[storeId]/` subtree survived that commit because
 * `[storeId]/page.tsx` imported `parseCogsFilters` from
 * `../components/sections/data` and its shell imported four more from the same
 * folder — ruling L-R16's coupling, found first on the labour route. Nothing
 * imports them once this page replaces the last consumer, so the whole subtree
 * goes here.
 *
 * ## The scope is the PATH, and `?store=` is what the rail writes
 *
 * Every other Counter page is scoped by `?store=`; this one is scoped by its
 * path segment, so a store picked from the rail's switcher arrives as a query
 * key this page does not read. It is reconciled below by redirecting to the
 * path that means what the reader just asked for, carrying the window with
 * them — the same reconciliation `analytics/[storeId]` and `labor/[storeId]`
 * both make, and for the same reason.
 *
 * "All stores" deletes the key rather than setting one, so it cannot be told
 * apart from a plain visit; the way back is the rail's own COGS item, which is
 * the group page.
 *
 * ## Three different absences, and only one of them is a 404
 *
 * A store id this account does not own is `notFound()`, decided off the
 * switcher's own list so the rail cannot offer a store this page would 404 on.
 *
 * A store that EXISTS but that the cost rollup has no row for is not a 404 —
 * every section resolves empty with its own reason, so the page refuses per
 * section rather than quietly answering for the whole account.
 *
 * A `pre_open` store is the third case: "Not trading yet", which is a fact
 * about the store and not a fault (A-R12, C-R8).
 *
 * The owner gate is the group page's, kept for the group page's reason: every
 * section here is money, so there is nothing left over for a reader without
 * owner access.
 */
export default async function StoreCogsPage({
  params,
  searchParams,
}: {
  params: Promise<{ storeId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (!hasOwnerAccess(session.user.role)) redirect("/dashboard")

  const { storeId } = await params

  const sp = await searchParams
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === "string") query.set(key, value)
  }

  const railStoreId = query.get("store")
  if (railStoreId !== null && railStoreId !== "" && railStoreId !== storeId) {
    const rest = writeCounterParams(query, { storeId: null }).toString()
    const href = `/dashboard/cogs/${encodeURIComponent(railStoreId)}`
    redirect(rest ? `${href}?${rest}` : href)
  }

  // Resolved once, here, and passed to both the params reader and the client
  // island — a moving `new Date()` re-evaluated in two places could disagree
  // about which calendar day "today" is.
  const today = new Date()
  const counterParams = readCounterParams(query, today)

  // Started before the sections rather than awaited in front of them: neither
  // depends on the other, and this page must have the list resolved to decide
  // the 404 below. `getOverviewStores` is `cache()`d, so the layout's copy and
  // this one are one query per request.
  const storesP = getOverviewStores()

  // NOT AWAITED — one promise per section, each unwrapped inside its own
  // Suspense boundary by `Section`. "What moved" walks the ingredient price
  // monitor's own thirty-day comparison and is by far the slowest of the four;
  // it holds up the strip, the plan chart and the worst-margin table for
  // exactly as long as it holds up nothing.
  const sections = getStoreCogsSectionPromises({
    range: counterParams.range,
    // The PATH's store, never `counterParams.storeId` — the query string has
    // already been reconciled above.
    storeId,
    accountId: session.user.accountId,
  })

  const stores = await storesP
  if (!stores.some((s) => s.id === storeId)) notFound()

  return (
    <CounterStoreCogsClient
      // PLAIN TEXT, not the URLSearchParams above: a class instance crosses the
      // RSC boundary with its prototype stripped.
      params={query.toString()}
      storeId={storeId}
      stores={stores}
      today={today}
      sections={sections}
    />
  )
}
