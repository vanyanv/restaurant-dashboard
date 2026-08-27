import { getServerSession } from "next-auth"
import { notFound, redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { readCounterParams, writeCounterParams } from "@/lib/counter/url-state"
import { getStoreLaborSectionPromises } from "@/lib/counter/adapters/labor"
import { getOverviewStores } from "@/lib/counter/adapters/overview"
import { CounterPhoneStoreLaborClient } from "./counter-phone-store-labor-client"

/**
 * One store's Labor — the phone. Sibling of
 * `src/app/dashboard/(counter)/labor/[storeId]/page.tsx`, and it is
 * deliberately the same call: `getStoreLaborSectionPromises` shares
 * `loadEverything`, `headlineSection`, `scheduleSection` and `rolesSection`
 * with the desk sibling, so `/dashboard/labor/<id>` and this route cannot
 * print two labour percentages, two role splits or two SPLH figures for one
 * store's window.
 *
 * `LaborHeadline.phoneCells` and `RolesSection.phoneRows` were already built
 * for this route before it existed — the store arm of `buildHeadline`
 * publishes Labour % and Leak specifically for a store phone, never a slice
 * of the desk's four cells — so nothing here reshapes the desk's data; it
 * only renders fields that were waiting on a caller (see Task 7's own
 * concern).
 *
 * ## The owner gate, and why it redirects to `/m/more`
 *
 * Same ruling as the group phone page and the desk store page: five of this
 * route's six sections are the statement's Total Sales or the payroll built
 * on it, so a manager sent here would get a page whose subject is the wage
 * bill with the wage bill removed. `hasOwnerAccess` gates the whole route,
 * exactly as `/m/labor` and `/dashboard/labor/[storeId]` gate it. The
 * redirect target is `/m/more` rather than a desktop path, matching every
 * other phone route's own choice: bouncing to desktop from a phone request
 * sends it straight back through the middleware for an extra hop.
 *
 * ## The scope is the PATH, same reconciliation as the analytics sibling
 *
 * `PhoneShell`'s store sheet (`.mtop`'s `.st`) writes `?store=<id>` through
 * `onSelectStore`, and `storeScopeHref` sends it back to THIS SAME pathname
 * for any route that is not a record route — so picking a store from the
 * sheet while already on `/m/labor/<A>` arrives here as
 * `/m/labor/<A>?store=<B>`: two statements of scope, disagreeing, exactly the
 * case `analytics/[storeId]` and `dashboard/labor/[storeId]` resolve. It is
 * resolved the same way, in `?store=`'s favour, by redirecting to that
 * store's own path with the window carried over.
 *
 * ## The 404, and the refusal that is NOT a 404
 *
 * A store id this account does not own is `notFound()`, decided off the same
 * `getOverviewStores()` list `(counter)/layout.tsx` already fetched (it is
 * `cache()`d, so this is one query per request, not two). A store that
 * EXISTS but that Harri has no row for, or that is `pre_open`, is a
 * different fact and is not a 404 — every section below refuses on its own,
 * per `scopeReason`, exactly as the desk sibling's own six sections do.
 */
export default async function MobileStoreLaborPage({
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

  // The phone's store sheet wrote a store into the query string (see the note
  // above). The path is what scopes this page, so send the reader to the
  // path that means what they just asked for, carrying the window with them.
  const railStoreId = query.get("store")
  if (railStoreId !== null && railStoreId !== "" && railStoreId !== storeId) {
    const rest = writeCounterParams(query, { storeId: null }).toString()
    const href = `/m/labor/${encodeURIComponent(railStoreId)}`
    redirect(rest ? `${href}?${rest}` : href)
  }

  // Resolved once, here, and passed to both the params reader and the client
  // island — a moving `new Date()` re-evaluated in two places could disagree
  // about which calendar day "today" is.
  const today = new Date()
  const counterParams = readCounterParams(query, today)

  // The same cached list `(counter)/layout.tsx` already fetched for the
  // store sheet — started before the sections rather than awaited in front
  // of them, since neither depends on the other and this page must have the
  // list resolved to decide the 404 below.
  const storesP = getOverviewStores()

  // NOT AWAITED — one promise per section, each unwrapped inside its own
  // Suspense boundary by `Section`.
  //
  // There is no `comparisonId` in this call: `LaborSectionsInput` has no such
  // field, the same as every other Labor route.
  const sections = getStoreLaborSectionPromises({
    range: counterParams.range,
    // The PATH's store, never `counterParams.storeId` — the query string has
    // already been reconciled above.
    storeId,
    accountId: session.user.accountId,
    today,
  })

  const stores = await storesP
  if (!stores.some((s) => s.id === storeId)) notFound()

  return (
    <CounterPhoneStoreLaborClient
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
