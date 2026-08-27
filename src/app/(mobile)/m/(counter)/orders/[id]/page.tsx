import { getServerSession } from "next-auth"
import { notFound, redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getOrderSections } from "@/lib/counter/adapters/orders"
import { getOverviewStores } from "@/lib/counter/adapters/overview"
import { isMissing } from "@/lib/counter/section-data"
import { CounterPhoneOrderClient } from "./counter-phone-order-client"

export const dynamic = "force-dynamic"

/**
 * Counter — one order, the phone detail (Phase C, page 3, surface 4).
 *
 * `src/middleware.ts` rewrites `/dashboard/orders/<id>` to `/m/orders/<id>` on
 * a phone user agent, so this route IS the phone surface of an order, and it is
 * what `npm run fidelity`'s `fidelity-mobile` project measures against
 * `P.order.phone()`.
 *
 * It is a near-copy of `src/app/dashboard/orders/[id]/page.tsx` on purpose, and
 * the part that must stay identical is the middle: ONE `getOrderSections` call,
 * with the same id and the same account. Two surfaces asking two different
 * loaders what one order kept is how one restaurant ends up with two answers
 * for one order; here they cannot, because there is one adapter and it is this
 * one.
 *
 * ## What this replaces, and the figure it was getting wrong
 *
 * The editorial page at this path built its `FEES + TAX` masthead cell as
 * `fmtMoney(order.tax + order.commission)`. `OtterOrder.commission` is stored
 * NEGATIVE (`src/lib/counter/order-signs.ts` counted it: 25,648 rows below
 * zero, none above), so that expression SUBTRACTS the marketplace's cut from
 * the tax — printing a figure smaller than the tax alone, and negative on any
 * DoorDash order whose commission exceeds its tax. Nothing about the page
 * looked broken; it was a plausible number in the wrong direction. Going
 * through the adapter is what ends it: `buildOrderStrip` reads `feeAmount()`,
 * which is `Math.max(0, −commission)`, and the phone prints what it is given.
 *
 * ## No searchParams, because there is no window
 *
 * `P.order` is `nodate: true`. An order happened at one instant — there is no
 * range to widen, no comparison to make, and nothing for `?range=` to mean.
 *
 * ## No owner gate, same as the list
 *
 * `getOrderDetail` is scoped to the session's own account. A manager who can
 * see the orders list can see an order on it. Contrast `/m/pnl`, where every
 * section is the one owner-only rollup and a non-owner is redirected.
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
 * one belonging to another account. `isMissing` reads the `empty` that becomes
 * — NOT `!hasData`, which is equally true of `failed`: an outage must render a
 * page of failed sections, not tell the reader their order does not exist.
 */
export default async function MobileOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const { id } = await params

  // The switcher's list, shared with the Overview rather than re-queried, so
  // the phone's store sheet cannot offer a store the desk's rail does not.
  const stores = await getOverviewStores()
  const sections = await getOrderSections({
    orderId: id,
    accountId: session.user.accountId,
  })

  if (isMissing(sections.head)) notFound()

  return <CounterPhoneOrderClient stores={stores} sections={sections} />
}
