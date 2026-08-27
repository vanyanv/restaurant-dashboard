import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { readCounterParams } from "@/lib/counter/url-state"
import { getDecisionsSectionPromises } from "@/lib/counter/adapters/decisions"
import { CounterPhoneDecisionsClient } from "./counter-phone-decisions-client"

export const dynamic = "force-dynamic"

/**
 * Counter Needs-you — "The week ahead", the phone (`P.decisions.phone`,
 * `docs/counter/counter-prototype.html:4762`).
 *
 * `src/middleware.ts` rewrites `/dashboard/decisions` to `/m/decisions` on a
 * phone user agent, so this route IS the phone surface of the week, and it is
 * what `npm run fidelity`'s `fidelity-mobile` project will measure against
 * `P.decisions.phone()`.
 *
 * It is a near-copy of `src/app/dashboard/(counter)/decisions/page.tsx` on
 * purpose, and the part that must stay identical is the middle: ONE
 * `getDecisionsSectionPromises` call, with the store and the picked day read
 * off the same `readCounterParams`. Two surfaces asking two loaders what the
 * week holds is how one restaurant ends up with two answers for one week;
 * here they cannot, because there is one adapter and it is this one.
 *
 * ## `?day=` is read here even though the phone draws no picker
 *
 * It travels in a LINK. A desk reader who presses Tuesday and sends the URL
 * to a phone must land on Tuesday — and the section this phone does not draw
 * (the day detail) is still built for that day by the adapter, so the two
 * surfaces stay on one day rather than one silently falling back to today.
 * Dropping the key here would make a shared link mean something different at
 * each end, which is the same failure as reading two ranges.
 *
 * ## The owner gate, same as the desk
 *
 * Every section is the whole-account week — `computeVitals` rolls up labour
 * and sales per labour hour across the account's stores, and the ledger is
 * the owner's own record. A non-owner is redirected to `/m/more`, the phone's
 * settings, rather than `/dashboard/settings`, which on a phone bounces back
 * through the middleware for an extra hop.
 */
export default async function MobileDecisionsPage({
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
  // which calendar day "today" is, and on this page that decides which WEEK
  // `.msub` names.
  const today = new Date()
  const counterParams = readCounterParams(params, today)

  // NOT AWAITED — one promise per section, each unwrapped inside its own
  // Suspense boundary by `Section`. THE SAME CALL, WITH THE SAME ARGUMENTS,
  // as the desk.
  const sections = getDecisionsSectionPromises({
    storeId: counterParams.storeId ?? undefined,
    day: counterParams.day ?? undefined,
  })

  return (
    <>
      <CounterPhoneDecisionsClient
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
      <span hidden data-perf-ready="/m/decisions" />
    </>
  )
}
