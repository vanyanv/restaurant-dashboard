import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { readCounterParams } from "@/lib/counter/url-state"
import { getLaborSectionPromises } from "@/lib/counter/adapters/labor"
import { getOverviewStores } from "@/lib/counter/adapters/overview"
import { CounterLaborClient } from "./counter-labor-client"

/**
 * Counter Labor, the group page — what the hours cost, against the schedule the
 * store published for itself (`P.labor.desk`,
 * `docs/counter/counter-prototype.html:5528`).
 *
 * The route GRADUATED out of `(editorial)` to get here, the same move Analytics
 * and the P&L made: a page rebuilt on Counter leaves that route group, which is
 * both the migration mechanism and the way anyone sees what is left
 * (`ls src/app/dashboard/(editorial)`). The editorial `/dashboard/labor`
 * `page.tsx` was deleted in the same commit — both resolved to
 * `/dashboard/labor`, and Next fails the build on two pages resolving to one
 * path. Its `components/` and its `labor.css` outlived that commit by exactly
 * one task, because the editorial `[storeId]/page.tsx` still imported from
 * both; Task 7 rebuilt that route here too and took all three with it, so
 * `src/app/dashboard/(editorial)/labor` no longer exists in any form.
 *
 * A page resolves the session, reads the URL params ONCE, calls exactly one
 * adapter and hands plain serialisable props to a client island. It never
 * imports Prisma or an action directly and never inspects `SectionData.status`
 * — `npm run tokens` fails the build on either, and on an `AppShell` mounted
 * here (`no-shell-in-page`), on a missing `loading.tsx`
 * (`no-route-without-loading`), or on an `await`ed `get*Sections(...)`
 * (`no-awaited-sections-in-page`).
 *
 * ## The owner gate, and why this page keeps the one Analytics dropped
 *
 * Analytics has no gate because `loadStatement`'s refusal would only silence
 * three of its four sections, and the fourth — "when the orders come" — is a
 * whole reading off `OtterHourlySummary` that belongs to any reader.
 *
 * That test is not met here, in the other direction. Six of these eight
 * sections are the statement's own Total Sales or the payroll built on it: the
 * headline percentage, the week strip, the schedule, the role split with its
 * per-position cost, the leak ledger's dollars, and the twelve-week trend. What
 * is left without owner access is a staffing curve and a schedule gap — the
 * two sections that carry no money at all. A manager sent here would get a page
 * whose subject is the wage bill with the wage bill removed.
 *
 * `hasOwnerAccess` is the check the editorial page deleted in this commit
 * already carried — kept, not reintroduced — and it is the same one the P&L
 * and the Needs-you page make for the same reason.
 */
export default async function LaborPage({
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
  const today = new Date()
  const counterParams = readCounterParams(params, today)

  // NOT AWAITED — one promise per section, each unwrapped inside its own
  // Suspense boundary by `Section`. The staffing curve and the schedule gap are
  // their own queries against `ForecastHourlyOrders`, this page's slowest, and
  // they hold up the strip and the role table for exactly as long as they hold
  // up nothing.
  //
  // There is no `comparisonId` in this call and that is not an omission:
  // `LaborSectionsInput` has no such field. Nothing on this page is drawn
  // against a comparison window, which is why the subtitle in the island does
  // not name one either.
  const sections = getLaborSectionPromises({
    range: counterParams.range,
    storeId: counterParams.storeId,
    accountId: session.user.accountId,
    // The SAME `today` the params reader and the island get. Only the week
    // strip's `is-today` reads it: the cell marked is the reader's actual day
    // when the range contains it, and no cell at all when it does not.
    today,
  })

  // The switcher's list. Shared with the Overview rather than re-queried, so
  // the rail cannot offer one page a store the other does not have.
  const stores = await getOverviewStores()

  return (
    <CounterLaborClient
      // PLAIN TEXT, not the URLSearchParams above: a class instance crosses the
      // RSC boundary with its prototype stripped. See the island's own note.
      params={params.toString()}
      stores={stores}
      today={today}
      sections={sections}
    />
  )
}
