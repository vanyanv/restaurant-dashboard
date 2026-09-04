import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { readCounterParams } from "@/lib/counter/url-state"
import { getPnlSectionPromises } from "@/lib/counter/adapters/pnl"
import { getStoreFixedSectionPromises } from "@/lib/counter/adapters/pnl-store"
import { CounterPhonePnlClient } from "./counter-phone-pnl-client"
import { counterToday } from "@/lib/counter/today"

export const dynamic = "force-dynamic"

/**
 * Counter P&L — the phone (Phase C, page 2, surface 2).
 *
 * `src/proxy.ts` rewrites `/dashboard/pnl` to `/m/pnl` on a phone user
 * agent, so this route IS the phone surface of the P&L, and it is what
 * `npm run fidelity`'s `fidelity-mobile` project measures against
 * `P.pnl.phone()`.
 *
 * It is a near-copy of `src/app/dashboard/pnl/page.tsx` on purpose, and the
 * part that must stay identical is the middle: ONE `getPnlSections` call, with
 * the range, comparison and store read off the same `readCounterParams`. Two
 * surfaces asking two different loaders for "the bottom line" is how one
 * restaurant ends up with two answers for one range; here they cannot,
 * because there is one adapter and it is this one.
 *
 * ## The owner gate, and why it redirects rather than degrades
 *
 * Ruling C-R4, the same on both surfaces: `getAllStoresPnL` refuses a
 * non-owner and every section on this page is that one rollup, so a reader
 * without owner access would get a page of "restricted to owners" boxes. It
 * redirects to `/m/more` — the phone's settings — rather than
 * `/dashboard/settings`, which on a phone bounces back through the middleware
 * for an extra hop.
 */
export default async function MobilePnlPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (!hasOwnerAccess(session.user.role)) redirect("/m/more")

  const sp = await searchParams
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === "string") params.set(key, value)
  }

  // Resolved once, here, and passed to both the params reader and the island —
  // a moving `new Date()` re-evaluated in two places could disagree about
  // which calendar day "today" is, and the weeks are anchored on today rather
  // than on the range (note 53).
  const today = counterToday()
  const counterParams = readCounterParams(params, today)

  // NOT AWAITED — one promise per section, each unwrapped inside its own
  // Suspense boundary by `Section`. See the desk page's note.
  const sections = getPnlSectionPromises({
    range: counterParams.range,
    comparisonId: counterParams.comparisonId,
    storeId: counterParams.storeId,
    accountId: session.user.accountId,
    today,
  })

  /*
   * `P.pnlstore`'s fixed-cost section, started only when a store is SELECTED
   * — the same call the desk page makes, for the reason `pnl-store.ts` states:
   * a store is a PARAM on one P&L, not a second composition. The desk has
   * carried this since the section was written and the phone did not, so
   * `/m/pnl?store=<id>` was the group statement filtered to one store with the
   * part that is ABOUT that store missing.
   */
  const storeSections = counterParams.storeId
    ? getStoreFixedSectionPromises({
        range: counterParams.range,
        comparisonId: counterParams.comparisonId,
        storeId: counterParams.storeId,
        accountId: session.user.accountId,
        today,
      })
    : null

  return (
    <>
      <CounterPhonePnlClient
        storeSections={storeSections}
        // PLAIN TEXT, not the URLSearchParams above: a class instance crosses
        // the RSC boundary with its prototype stripped.
        params={params.toString()}
        today={today}
        sections={sections}
      />
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
      <span hidden data-perf-ready="/m/pnl" />
    </>
  )
}
