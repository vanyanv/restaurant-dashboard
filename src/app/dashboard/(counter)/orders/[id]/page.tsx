import { getServerSession } from "next-auth"
import { notFound, redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getOrderSections } from "@/lib/counter/adapters/orders"
import { getOverviewStores } from "@/lib/counter/adapters/overview"
import { isMissing } from "@/lib/counter/section-data"
import { CounterOrderClient } from "./counter-order-client"

/**
 * Counter — one order, the desk detail (Phase C, page 3, surface 3).
 *
 * The route GRADUATED out of `(editorial)` to get here, and the old
 * `(editorial)/orders/[id]/` was deleted in the same commit: both resolved to
 * `/dashboard/orders/<id>` and Next fails the build on two pages resolving to
 * one path.
 *
 * A page resolves the session, calls exactly ONE adapter and hands plain
 * serialisable props to a client island. It never imports Prisma or an action
 * directly and never inspects `SectionData.status` — `npm run tokens` fails
 * the build on either.
 *
 * ## No searchParams, because there is no window
 *
 * Every other Counter page reads `readCounterParams` and passes the query
 * string down. This one does not, and that is `nodate: true` all the way
 * through: an order happened at one instant, so there is no range to widen, no
 * comparison to make and nothing for `?range=` to mean. Reading the params and
 * then ignoring them would put a filter in the URL that changes nothing.
 *
 * ## No owner gate, same as the list
 *
 * `getOrderDetail` is scoped to the session's own account and `getOrderSections`
 * passes `session.user.accountId` to the costing batch. A manager who can see
 * the orders list can see an order on it. Contrast `/dashboard/pnl`, where
 * every section is the one owner-only rollup.
 *
 *
 * ## Why this page does NOT stream its sections, and it is not an oversight
 *
 * Task 3 gave every other Counter page a promise per section, each unwrapped
 * inside its own Suspense boundary. This one keeps the single `await`, because
 * there is nothing here to isolate: `getOrderSections` is ONE `getOrderDetail`
 * load plus one costing batch, and all seven sections are `mapReadyTo` over
 * that same value. Seven promises resolving in the same tick would be a
 * picture of streaming rather than streaming, and it would cost something
 * real — the head and the platform rows are read at PAGE level, for the
 * masthead's title and for the store the rail names, and this page must
 * already have the head resolved to decide the 404 below.
 *
 * `Section` takes either half of `SectionSource`, so nothing about this page
 * is a different API from the streaming ones. When an order grows a section
 * with a loader of its own, that section becomes a promise and this note
 * shrinks.
 * ## The 404
 *
 * `getOrderDetail` returns `null` both for an id that does not exist and for
 * one belonging to another account, and `classify`'s `isEmpty` turns that into
 * `empty` on every section. `isMissing` reads exactly that — NOT `!hasData`,
 * which is equally true of `failed`: a database outage must render a page of
 * failed sections, not tell the reader their order does not exist.
 */
export default async function OrderPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const { id } = await params

  // The rail's switcher is the LAYOUT's now; this list is for the page's own
  // content — it is how the store NAMED on the Platform section becomes the id
  // the rail shows as picked. `getOverviewStores` is `cache()`d, so the
  // layout's call and this one are one query per request.
  const stores = await getOverviewStores()
  const sections = await getOrderSections({
    orderId: id,
    accountId: session.user.accountId,
  })

  if (isMissing(sections.head)) notFound()

  return (
    <CounterOrderClient stores={stores} sections={sections} />
  )
}
