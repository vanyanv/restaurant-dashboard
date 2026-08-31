import { getServerSession } from "next-auth"
import { notFound, redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { readCounterParams, writeCounterParams } from "@/lib/counter/url-state"
import { getStoreCogsSectionPromises } from "@/lib/counter/adapters/cogs"
import { getOverviewStores } from "@/lib/counter/adapters/overview"
import { CounterPhoneStoreCogsClient } from "./counter-phone-store-cogs-client"
import { counterToday } from "@/lib/counter/today"

export const dynamic = "force-dynamic"

/**
 * One store's COGS, on a phone — the last of the four COGS surfaces.
 *
 * It calls `getStoreCogsSectionPromises`, the same function
 * `src/app/dashboard/(counter)/cogs/[storeId]/page.tsx` calls, and that is
 * deliberate: one adapter is what stops a phone and a desk printing two food
 * costs for one store. The adapter publishes `phoneCells` and `phoneRows`
 * beside the desk's own arrays wherever the two surfaces genuinely differ, so
 * this island reshapes nothing.
 *
 * ## The owner gate redirects to `/m/more`
 *
 * Every section here is money, so there is nothing left over for a reader
 * without owner access — the same reasoning `/m/cogs` and the desk pages
 * carry. The target is `/m/more` rather than a desktop path, matching every
 * other phone gate: a phone reader bounced to `/dashboard` would be rewritten
 * straight back by the middleware.
 *
 * ## The scope is the PATH, and `?store=` is what the switcher writes
 *
 * `PhoneShell`'s store sheet writes `?store=`, and this route is scoped by its
 * path segment, so the two are reconciled below in the query's favour by
 * redirecting to the path the reader just asked for — the same resolution
 * `analytics/[storeId]` and `labor/[storeId]` make on both surfaces.
 *
 * ## Three absences, one 404
 *
 * A store id this account does not own is `notFound()`, decided off the same
 * `getOverviewStores()` list the layout already fetched — it is `cache()`d, so
 * the two are one query. A store that exists but has no cost rows is NOT a
 * 404: every section resolves empty with its own reason. A `pre_open` store is
 * "Not trading yet", a fact about the store rather than a fault (A-R12, C-R8).
 */
export default async function MobileStoreCogsPage({
  params,
  searchParams,
}: {
  params: Promise<{ storeId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (!hasOwnerAccess(session.user.role)) redirect("/m/more")

  const { storeId } = await params

  const sp = await searchParams
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === "string") query.set(key, value)
  }

  const sheetStoreId = query.get("store")
  if (sheetStoreId !== null && sheetStoreId !== "" && sheetStoreId !== storeId) {
    const rest = writeCounterParams(query, { storeId: null }).toString()
    const href = `/m/cogs/${encodeURIComponent(sheetStoreId)}`
    redirect(rest ? `${href}?${rest}` : href)
  }

  const today = counterToday()
  const counterParams = readCounterParams(query, today)

  const storesP = getOverviewStores()

  // NOT AWAITED — one promise per section, each unwrapped inside its own
  // Suspense boundary by `Section`. "What moved" walks the ingredient price
  // monitor's own thirty-day comparison and is the slowest of the four.
  const sections = getStoreCogsSectionPromises({
    range: counterParams.range,
    // The PATH's store, never `counterParams.storeId` — reconciled above.
    storeId,
    accountId: session.user.accountId,
  })

  const stores = await storesP
  if (!stores.some((s) => s.id === storeId)) notFound()

  return (
    <>
      <CounterPhoneStoreCogsClient
        // PLAIN TEXT, not the URLSearchParams above: a class instance crosses
        // the RSC boundary with its prototype stripped.
        params={query.toString()}
        storeId={storeId}
        stores={stores}
        today={today}
        sections={sections}
      />
      {/* The perf harness's marker — a hidden sibling, not a wrapper. See
          `(mobile)/m/(counter)/pnl/page.tsx`'s note. */}
      <span hidden data-perf-ready="/m/cogs/[storeId]" />
    </>
  )
}
