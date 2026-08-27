import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { readCounterParams } from "@/lib/counter/url-state"
import { getOrdersSectionPromises } from "@/lib/counter/adapters/orders"
import { CounterPhoneOrdersClient } from "./counter-phone-orders-client"

export const dynamic = "force-dynamic"

/**
 * Counter Orders — the phone (Phase C, page 3, surface 2).
 *
 * `src/middleware.ts` rewrites `/dashboard/orders` to `/m/orders` on a phone
 * user agent, so this route IS the phone surface of the orders list, and it is
 * what `npm run fidelity`'s `fidelity-mobile` project measures against
 * `P.orders.phone()`.
 *
 * It is a near-copy of `src/app/dashboard/orders/page.tsx` on purpose, and the
 * part that must stay identical is the middle: ONE `getOrdersSections` call,
 * with the range, comparison, store, channels and search read off the same
 * `readCounterParams`. Two surfaces asking two different loaders how many
 * orders came in is how one restaurant ends up with two answers for one range;
 * here they cannot, because there is one adapter and it is this one.
 *
 * ## The filters are read here even though the phone draws no filter bar
 *
 * `P.orders.phone()` has no `.filters`, so the island never renders one — but
 * `?ch=` and `?q=` are still passed to the adapter. They travel in a LINK: a
 * desk reader who narrows the list to DoorDash and sends the URL to a phone
 * must get the DoorDash list, not the whole day's. Dropping them here would
 * silently widen a shared filter, and the figures above the list would then be
 * counting different orders than the sender saw.
 *
 * ## No owner gate, same as the desk
 *
 * `getOrdersList` and `getHourlyPatternsForRange` are scoped to the session's
 * own account. A manager who can see the dashboard can see the orders that
 * came through their own store, and a gate here would hide a manager's own
 * day's work from them. Contrast `/m/pnl`, where every section is the one
 * owner-only rollup and a non-owner is redirected to `/m/more`.
 */
export default async function MobileOrdersPage({
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

  // Resolved once, here, and passed to both the params reader and the island —
  // a moving `new Date()` re-evaluated in two places could disagree about
  // which calendar day "today" is.
  const today = new Date()
  const counterParams = readCounterParams(params, today)

  // NOT AWAITED — one promise per section, each unwrapped inside its own
  // Suspense boundary by `Section`. See the desk page's note.
  const sections = getOrdersSectionPromises({
    range: counterParams.range,
    comparisonId: counterParams.comparisonId,
    storeId: counterParams.storeId,
    channels: counterParams.channels,
    search: counterParams.search,
  })

  return (
    <>
      <CounterPhoneOrdersClient sections={sections} />
      {/*
       * The perf harness's marker (`scripts/mobile-transition-perf.ts`), which
       * used to be a `<div>` WRAPPING the island. The island no longer brings
       * its own `.mscroll` — that is the `(counter)` layout's now — so a
       * wrapper here would land INSIDE `.mscroll`, whose `display:grid` +
       * `gap:11px` and `> *:nth-child()` entry delays are written against the
       * page's blocks being its direct children. `hidden` keeps it out of the
       * grid entirely (`display:none` is not a grid item), and LAST keeps
       * every existing block's `nth-child` index where it was.
       */}
      <span hidden data-perf-ready="/m/orders" />
    </>
  )
}
