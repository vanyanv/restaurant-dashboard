import { getServerSession } from "next-auth"
import { notFound, redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { readCounterParams, writeCounterParams } from "@/lib/counter/url-state"
import { getStoreLaborSectionPromises } from "@/lib/counter/adapters/labor"
import { getOverviewStores } from "@/lib/counter/adapters/overview"
import { CounterStoreLaborClient } from "./counter-store-labor-client"
import { counterToday } from "@/lib/counter/today"

/**
 * Counter Labor for ONE store — the sibling of `../page.tsx`, composed from
 * `P.laborstore.desk()` (`docs/counter/counter-prototype.html:7671`).
 *
 * Five of its six sections are the group page's own builders called with a
 * `storeId`: `getStoreLaborSectionPromises` shares `loadEverything`,
 * `headlineSection`, `scheduleSection`, `rolesSection`, `leaksSection` and
 * `trendSection` with `getLaborSectionPromises`, so
 * `/dashboard/labor?store=<id>` and this route cannot print two labour
 * percentages, two role splits or two leak totals for one window.
 *
 * What this route adds — and its whole argument for existing — is the week
 * TABLE, one row per day with what that day cost against the schedule the
 * store published for it. The group page has no room to draw that once per
 * store, which is why it draws a seven-cell strip instead.
 *
 * A page resolves the session, reads the URL params ONCE, calls exactly one
 * adapter and hands plain serialisable props to a client island. It never
 * imports Prisma or an action directly and never inspects `SectionData.status`
 * — `npm run tokens` fails the build on either, and on an `AppShell` mounted
 * here (`no-shell-in-page`), on a missing `loading.tsx`
 * (`no-route-without-loading`), or on an `await`ed `get*Sections(...)`
 * (`no-awaited-sections-in-page`).
 *
 * ## The owner gate, kept from the group page for the same reason
 *
 * Five of these six sections are the statement's own Total Sales or the
 * payroll built on it: the headline percentage, the role split with its
 * per-position cost, the leak ledger's dollars, the week table's Sales and
 * Labor % columns, and the twelve-week trend. What survives without owner
 * access is one chart of hours. A manager sent here would get a page whose
 * subject is the wage bill with the wage bill removed — so `hasOwnerAccess`
 * gates it, exactly as it gates `/dashboard/labor`, the P&L and Needs-you.
 *
 * ## The scope is the PATH, and `?store=` is what the rail writes
 *
 * The identical collision `analytics/[storeId]` resolves, resolved the
 * identical way. The rail's store switcher lives in `(counter)/layout.tsx` and
 * knows only `?store=` — `AppShell` pushes `{ storeId }` onto
 * `storeScopeHref(pathname)`, which on this route is this route — so picking a
 * store in the rail arrives here as `/dashboard/labor/<A>?store=<B>`: two
 * statements of scope, disagreeing. It is settled HERE, on the server, in
 * `?store=`'s favour, by redirecting to that store's own path with the window
 * carried over. Anything else makes every link a reader copies off this page a
 * link to the wrong store's payroll.
 *
 * "All stores" (a `storeId: null` push) deletes the key and so cannot be
 * distinguished here from a plain visit; the way back to every store is the
 * rail's own Labor item, which is the group page.
 *
 * ## The 404, and the refusals that are NOT 404s
 *
 * A store id this account does not own is `notFound()`, decided off the
 * switcher's own list so the rail cannot offer a store this page would 404 on.
 *
 * A store that EXISTS but has not opened is a different fact and is not a 404.
 * `scopeReason` publishes `pre_open` once, in `loadEverything`, and every
 * section carries it — so Van Nuys and Glendale, which have not one Harri
 * shift, alert or position row between them, render six reasoned refusals and
 * never a heading over a blank panel.
 */
export default async function StoreLaborPage({
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

  // The rail wrote a store into the query string (see the note above). The
  // path is what scopes this page, so send the reader to the path that means
  // what they just asked for, carrying the window with them.
  const railStoreId = query.get("store")
  if (railStoreId !== null && railStoreId !== "" && railStoreId !== storeId) {
    const rest = writeCounterParams(query, { storeId: null }).toString()
    const href = `/dashboard/labor/${encodeURIComponent(railStoreId)}`
    redirect(rest ? `${href}?${rest}` : href)
  }

  // Resolved once, here, and passed to both the params reader and the client
  // island — a moving `new Date()` re-evaluated in two places could disagree
  // about which calendar day "today" is.
  const today = counterToday()
  const counterParams = readCounterParams(query, today)

  // The switcher's list, started before the sections rather than awaited in
  // front of them: neither depends on the other, and this page must have the
  // list resolved to decide the 404 below. `getOverviewStores` is `cache()`d,
  // so the layout's copy and this one are one query per request.
  const storesP = getOverviewStores()

  // NOT AWAITED — one promise per section, each unwrapped inside its own
  // Suspense boundary by `Section`. The trend loads twelve weeks of statement
  // alongside twelve weeks of Harri rows and is this page's slowest; it holds
  // up the strip and the week table for exactly as long as it holds up
  // nothing.
  //
  // There is no `comparisonId` in this call and that is not an omission:
  // `LaborSectionsInput` has no such field. Nothing on this page is drawn
  // against a comparison window, which is why the subtitle in the island does
  // not name one either.
  const sections = getStoreLaborSectionPromises({
    range: counterParams.range,
    // The PATH's store, never `counterParams.storeId` — the query string has
    // already been reconciled above.
    storeId,
    accountId: session.user.accountId,
    // The same `today` the params reader and the island get. No section on
    // THIS route reads it (the week strip's `is-today` belongs to the group
    // page), but `LaborSectionsInput` requires it and one clock resolved in
    // one place is the rule that keeps it that way.
    today,
  })

  const stores = await storesP
  if (!stores.some((s) => s.id === storeId)) notFound()

  return (
    <CounterStoreLaborClient
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
