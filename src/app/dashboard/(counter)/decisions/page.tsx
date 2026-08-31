import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { readCounterParams } from "@/lib/counter/url-state"
import { getDecisionsSectionPromises } from "@/lib/counter/adapters/decisions"
import { getOverviewStores } from "@/lib/counter/adapters/overview"
import { CounterDecisionsClient } from "./counter-decisions-client"
import { counterToday } from "@/lib/counter/today"

/**
 * Counter Needs-you — "The week ahead", the desk surface (`P.decisions.desk`,
 * `docs/counter/counter-prototype.html:4682`).
 *
 * The route GRADUATED out of `(editorial)` to get here, and the editorial
 * `/dashboard/decisions` — its nine components and its own stylesheet — was
 * deleted in the same commit: both resolved to `/dashboard/decisions`, and
 * Next fails the build on two pages resolving to one path. Its `lib/` stays
 * where it is, because `src/app/actions/decisions/get-decisions-view.ts` is
 * built out of eleven of those twelve modules and is the loader this page
 * reads through. Deleting the route is not deleting the arithmetic behind it.
 *
 * A page resolves the session, reads the URL params ONCE, calls exactly one
 * adapter and hands plain serialisable props to a client island. It never
 * imports Prisma or an action directly and never inspects `SectionData.status`
 * — `npm run tokens` fails the build on either, and on an `AppShell` mounted
 * here (`no-shell-in-page`) or a `loading.tsx` missing beside it
 * (`no-route-without-loading`).
 *
 * ## The owner gate, and why this page has one where Orders does not
 *
 * The same reason the P&L has one. Every section here is the whole-account
 * week: `getDecisionsView` resolves the account's stores, `computeVitals`
 * rolls up labour and sales per labour hour across them, and the ledger is
 * the owner's own record of decisions taken. A manager landing here would get
 * a page about a business they do not see the books for. `hasOwnerAccess` is
 * the same check the editorial page carried, kept.
 */
export default async function DecisionsPage({
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
  // about which calendar day "today" is, and on this page that decides which
  // WEEK the picker draws.
  const today = counterToday()
  const counterParams = readCounterParams(params, today)

  // NOT AWAITED — one promise per section, each unwrapped inside its own
  // Suspense boundary by `Section` (ruling N-R13 and N-R15: the promises entry
  // point means this route needs no `AWAITED_SECTIONS_ALLOWED` exemption).
  // Started before the store list so the two are concurrent.
  const sections = getDecisionsSectionPromises({
    storeId: counterParams.storeId ?? undefined,
    // Straight off the URL, and the SAME key the phone reads. A day pressed
    // on the desk and a link opened on a phone land on one day.
    day: counterParams.day ?? undefined,
  })

  // The rail's switcher is the LAYOUT's; this list is for the page's own
  // content — the store the sub-line names. `getOverviewStores` is `cache()`d,
  // so the layout's call and this one are one query per request.
  const stores = await getOverviewStores()

  return (
    <CounterDecisionsClient
      // PLAIN TEXT, not the URLSearchParams above: a class instance crosses the
      // RSC boundary with its prototype stripped.
      params={params.toString()}
      stores={stores}
      today={today}
      sections={sections}
    />
  )
}
