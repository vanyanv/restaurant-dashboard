import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { readCounterParams } from "@/lib/counter/url-state"
import { getAlertsSections } from "@/lib/counter/adapters/alerts"
import { CounterPhoneAlertsClient } from "./counter-phone-alerts-client"
import { counterToday } from "@/lib/counter/today"

export const dynamic = "force-dynamic"

/**
 * Counter Needs-you — "Open right now", the phone (`P.alerts.phone`,
 * `docs/counter/counter-prototype.html:4820`).
 *
 * `src/proxy.ts` rewrites `/dashboard/alerts` to `/m/alerts` on a phone
 * user agent, so this route IS the phone surface of the inbox, and it is what
 * `npm run fidelity`'s `fidelity-mobile` project will measure against
 * `P.alerts.phone()`.
 *
 * It is a near-copy of `src/app/dashboard/(counter)/alerts/page.tsx` on
 * purpose, and the part that must stay identical is the middle: ONE
 * `getAlertsSections` call, with the store, the segment, both toggle rows and
 * the search read off the same `readCounterParams`. Two surfaces asking two
 * loaders what is open is how one restaurant ends up with two answers for one
 * inbox; here they cannot, because there is one adapter and it is this one.
 *
 * ## The filters are read here even though the phone draws none
 *
 * They travel in a LINK. A desk reader who presses `Critical`, or moves to the
 * `All` segment, and sends the URL to a phone must land on the same list —
 * and the adapter applies those params either way. Dropping them here would
 * make one link mean two different things at its two ends, which is the same
 * failure as reading two horizons.
 *
 * ## The single `await`, and the owner gate
 *
 * `getAlertsSections` is one `getAlertInbox` load and every section is a
 * projection of its single result, so this path is named in
 * `AWAITED_SECTIONS_ALLOWED` beside the desk's — see that page's own note for
 * why that is the opposite call from `/m/decisions`, and what distinguishes
 * the two.
 *
 * Every figure here is the account's whole inbox and `getAlertInbox` refuses a
 * non-owner outright (N-R8, unchanged). A non-owner is redirected to
 * `/m/more`, the phone's settings, rather than `/dashboard/settings`, which on
 * a phone bounces back through the middleware for an extra hop.
 */
export default async function MobileAlertsPage({
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
  // which calendar day "today" is, and on this page that decides how old every
  // row says it is.
  const today = counterToday()
  const counterParams = readCounterParams(params, today)

  // THE SAME CALL, WITH THE SAME ARGUMENTS, as the desk.
  const sections = await getAlertsSections({
    storeId: counterParams.storeId ?? undefined,
    segment: counterParams.segment,
    severities: counterParams.severities,
    sources: counterParams.sources,
    search: counterParams.search,
    today,
  })

  return (
    <>
      <CounterPhoneAlertsClient
        // PLAIN TEXT, not the URLSearchParams above: a class instance crosses
        // the RSC boundary with its prototype stripped.
        params={params.toString()}
        today={today}
        sections={sections}
      />
      {/*
       * The perf harness's marker (`scripts/mobile-transition-perf.ts`). Kept
       * OUT of `.mscroll`'s grid with `hidden` and placed LAST, so no block's
       * `nth-child` entry delay moves — see `/m/pnl`'s own note.
       */}
      <span hidden data-perf-ready="/m/alerts" />
    </>
  )
}
