import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { readCounterParams } from "@/lib/counter/url-state"
import { getOrdersSections } from "@/lib/counter/adapters/orders"
import { getOverviewStores } from "@/lib/counter/adapters/overview"
import { CounterOrdersClient } from "./counter-orders-client"

/** `OWNER` -> `Owner`. The rail prints a role, not an enum member. */
function titleCase(role: string): string {
  return role.charAt(0) + role.slice(1).toLowerCase()
}

/**
 * Counter Orders — the desk list (Phase C, page 3).
 *
 * The route GRADUATED out of `(editorial)` to get here: a page rebuilt on
 * Counter moves out of that route group, which is both the migration mechanism
 * and the way anyone sees what is left (`ls src/app/dashboard/(editorial)`).
 * The old `(editorial)/orders/page.tsx` and its two list components were
 * deleted in the same commit — both resolved to `/dashboard/orders`, and Next
 * fails the build on two pages resolving to one path.
 *
 * A page resolves the session, reads the URL params ONCE, calls exactly one
 * adapter and hands plain serialisable props to a client island. It never
 * imports Prisma or an action directly and never inspects `SectionData.status`
 * — `npm run tokens` fails the build on either.
 *
 * ## No owner gate, and that is the difference from the P&L
 *
 * `/dashboard/pnl` and `/dashboard` both redirect a non-owner, because every
 * section on either is the one owner-only rollup and a reader without owner
 * access would land on a page whose every block read "P&L is restricted to
 * owners". Orders is not that page. `getOrdersList` and
 * `getHourlyPatternsForRange` are scoped to the session's own account, and a
 * manager who can see the dashboard can see the orders that came through their
 * own store. Adding a gate here would hide a manager's own day's work from
 * them.
 */
export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

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

  // The switcher's list. Shared with the Overview rather than re-queried, so
  // the rail cannot offer one page a store the other does not have.
  const stores = await getOverviewStores()
  const sections = await getOrdersSections({
    range: counterParams.range,
    comparisonId: counterParams.comparisonId,
    storeId: counterParams.storeId,
    // The two filters, straight off the URL. Nothing about them is component
    // state, which is what makes a filtered list survive a reload and travel
    // in a link — and what lets the SERVER do the filtering, so the strip
    // above the table counts the same orders the table lists.
    channels: counterParams.channels,
    search: counterParams.search,
  })

  return (
    <CounterOrdersClient
      pathname="/dashboard/orders"
      // PLAIN TEXT, not the URLSearchParams above: a class instance crosses the
      // RSC boundary with its prototype stripped. See the island's own note.
      params={params.toString()}
      stores={stores}
      user={{ name: session.user.name, role: titleCase(session.user.role) }}
      today={today}
      sections={sections}
    />
  )
}
