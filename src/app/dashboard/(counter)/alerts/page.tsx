import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { readCounterParams } from "@/lib/counter/url-state"
import { getAlertsSections } from "@/lib/counter/adapters/alerts"
import { getOverviewStores } from "@/lib/counter/adapters/overview"
import { CounterAlertsClient } from "./counter-alerts-client"
import { counterToday } from "@/lib/counter/today"

/**
 * Counter Needs-you — "Open right now", the desk surface (`P.alerts.desk`,
 * `docs/counter/counter-prototype.html:4775`).
 *
 * The route GRADUATED out of `(editorial)` to get here, and the editorial
 * `/dashboard/alerts` — its page, its error boundary and its one row component
 * — was deleted in the same commit: both resolved to `/dashboard/alerts`, and
 * Next fails the build on two pages resolving to one path. It had no `lib/` of
 * its own to keep; the arithmetic it read through is
 * `src/app/actions/alerts/inbox-actions.ts`, which this page reads through
 * too, one adapter further along.
 *
 * A page resolves the session, reads the URL params ONCE, calls exactly one
 * adapter and hands plain serialisable props to a client island. It never
 * imports Prisma or an action directly and never inspects `SectionData.status`
 * — `npm run tokens` fails the build on either, and on an `AppShell` mounted
 * here (`no-shell-in-page`) or a `loading.tsx` missing beside it
 * (`no-route-without-loading`).
 *
 * ## Why this page AWAITS its sections where `/dashboard/decisions` does not
 *
 * `getAlertsSections` is ONE `getAlertInbox` load — a `findMany`, a `groupBy`
 * and two small scope reads, issued concurrently — and all seven sections are
 * projections of its single result. `getDecisionsView` is nine independent
 * queries, which is why that page hands its client one promise per section and
 * needs no exemption. Splitting one result into seven promises that settle in
 * the same tick would be a picture of streaming rather than streaming, so this
 * path is named in `AWAITED_SECTIONS_ALLOWED` (`scripts/counter-lint.ts`)
 * alongside the two order-detail routes. The distinguishing question is how
 * many INDEPENDENT QUERIES sit behind the sections, not how many sections
 * there are, and not how many loaders were written.
 *
 * ## The owner gate, and it is unchanged (N-R8)
 *
 * `getAlertInbox` already refuses a non-owner, and the editorial page it
 * replaces redirected one. Both are kept: the redirect below is what stops a
 * manager reaching a page of failed sections, and the loader's own check is
 * what stops anything reaching the rows if the redirect is ever moved.
 */
export default async function AlertsPage({
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
  // about which calendar day "today" is, and on this page that decides where
  // the opened-per-day chart's last bar sits.
  const today = counterToday()
  const counterParams = readCounterParams(params, today)

  // `Promise.all`, not two sequential `await`s: the store list and the inbox
  // don't depend on each other, and there is no reason for the second to wait
  // on the first to land. The rail's switcher is the LAYOUT's; this list is
  // for the page's own content — the store the sub-line names.
  // `getOverviewStores` is `cache()`d, so the layout's call and this one are
  // one query per request.
  const [stores, sections] = await Promise.all([
    getOverviewStores(),
    getAlertsSections({
      storeId: counterParams.storeId ?? undefined,
      segment: counterParams.segment,
      severities: counterParams.severities,
      sources: counterParams.sources,
      search: counterParams.search,
      today,
    }),
  ])

  return (
    <CounterAlertsClient
      // PLAIN TEXT, not the URLSearchParams above: a class instance crosses the
      // RSC boundary with its prototype stripped.
      params={params.toString()}
      storeName={stores.find((s) => s.id === counterParams.storeId)?.name ?? "All stores"}
      today={today}
      sections={sections}
    />
  )
}
