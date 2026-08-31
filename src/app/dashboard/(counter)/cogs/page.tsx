import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { readCounterParams } from "@/lib/counter/url-state"
import { getCogsSectionPromises } from "@/lib/counter/adapters/cogs"
import { getOverviewStores } from "@/lib/counter/adapters/overview"
import { CounterCogsClient } from "./counter-cogs-client"
import { counterToday } from "@/lib/counter/today"

/**
 * Counter COGS, the group page — what the food cost, against the plan the
 * store published for itself (`P.cogs.desk`,
 * `docs/counter/counter-prototype.html:5384`).
 *
 * The route GRADUATED out of `(editorial)` to get here, the same move
 * Analytics, the P&L and Labor made: a page rebuilt on Counter leaves that
 * route group, which is both the migration mechanism and the way anyone sees
 * what is left (`ls src/app/dashboard/(editorial)`). The editorial
 * `/dashboard/cogs` `page.tsx` was deleted in the same commit — both resolved
 * to `/dashboard/cogs`, and Next fails the build on two pages resolving to one
 * path. Its `components/`, its `error.tsx` and its `[storeId]/` subtree
 * SURVIVED that commit for one more step, because
 * `(editorial)/cogs/[storeId]/page.tsx` still imported `parseCogsFilters` from
 * `../components/sections/data` and its shell imported four more section
 * components from the same folder — exactly the coupling ruling L-R16 found on
 * the labour route. `(counter)/cogs/[storeId]` replaced that last consumer and
 * took the whole subtree with it, so `(editorial)/cogs` is gone.
 *
 * A page resolves the session, reads the URL params ONCE, calls exactly one
 * adapter and hands plain serialisable props to a client island. It never
 * imports Prisma or an action directly and never inspects `SectionData.status`
 * — `npm run tokens` fails the build on either, and on an `AppShell` mounted
 * here (`no-shell-in-page`), on a missing `loading.tsx`
 * (`no-route-without-loading`), or on an `await`ed `get*Sections(...)`
 * (`no-awaited-sections-in-page`).
 *
 * ## The owner gate, kept
 *
 * The editorial page this commit deletes already carried `hasOwnerAccess`, and
 * every one of these five sections is money: the food-cost percentage over the
 * statement's own Total Sales, the invoice backlog in dollars, ingredient
 * prices per recipe unit, the cost split by category, and what each item loses
 * against plan. There is nothing left over for a reader without owner access,
 * the way "when the orders come" is left over on Analytics. Kept, not
 * reintroduced — the same check the P&L, Labor and the Needs-you page make.
 */
export default async function CogsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (!hasOwnerAccess(session.user.role)) redirect("/dashboard")

  const sp = await searchParams
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === "string") params.set(key, value)
  }

  // Resolved once, here, and passed to both the params reader and the client
  // island — a moving `new Date()` re-evaluated in two places could disagree
  // about which calendar day "today" is.
  const today = counterToday()
  const counterParams = readCounterParams(params, today)

  // NOT AWAITED — one promise per section, each unwrapped inside its own
  // Suspense boundary by `Section`. "What moved" is by far the slowest of the
  // five: it walks the ingredient price monitor's own thirty-day comparison,
  // which is a different query from the cost window and fails on its own. It
  // holds up the strip, the plan chart, the ring and the item table for
  // exactly as long as it holds up nothing.
  //
  // There is no `comparisonId` in this call and that is not an omission:
  // `CogsSectionsInput` has no such field. Nothing on this page is drawn
  // against a comparison window, which is why the subtitle in the island does
  // not name one either.
  const sections = getCogsSectionPromises({
    range: counterParams.range,
    storeId: counterParams.storeId,
    accountId: session.user.accountId,
  })

  // The switcher's list. Shared with the Overview rather than re-queried, so
  // the rail cannot offer one page a store the other does not have.
  const stores = await getOverviewStores()

  return (
    <CounterCogsClient
      // PLAIN TEXT, not the URLSearchParams above: a class instance crosses the
      // RSC boundary with its prototype stripped. See the island's own note.
      params={params.toString()}
      stores={stores}
      today={today}
      sections={sections}
    />
  )
}
