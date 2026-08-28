import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { readCounterParams } from "@/lib/counter/url-state"
import { getLaborSectionPromises } from "@/lib/counter/adapters/labor"
import { CounterPhoneLaborClient } from "./counter-phone-labor-client"

export const dynamic = "force-dynamic"

/**
 * Counter Labor — the group page, on a phone.
 *
 * `src/proxy.ts` rewrites `/dashboard/labor` to `/m/labor` on a phone
 * user agent — a mapping this task ADDS; the key was simply missing before
 * it, so a phone reader landing on `/dashboard/labor` stayed on the desk page
 * with no route of its own to redirect to. This route is what
 * `npm run fidelity`'s `fidelity-mobile` project will measure against
 * `P.labor.phone()` once that project covers it.
 *
 * It is a near-copy of `src/app/dashboard/(counter)/labor/page.tsx` on
 * purpose, and the part that must stay identical is the middle: ONE
 * `getLaborSectionPromises` call, with the range, store and `today` read off
 * the same `readCounterParams`. Two surfaces asking two different loaders for
 * "what the hours cost" is how one restaurant ends up with two labour
 * percentages for one week; here they cannot, because there is one adapter
 * and it is this one.
 *
 * ## The owner gate, and why it redirects to `/m/more`
 *
 * Same ruling as the desk page's own note: six of the eight sections this
 * page reads are the statement's Total Sales or the payroll built on it, so a
 * manager sent here would get a page whose subject is the wage bill with the
 * wage bill removed. `hasOwnerAccess` gates the whole route, same as
 * `/dashboard/labor`. The redirect target is `/m/more` — the phone's
 * settings — rather than `/dashboard/settings`, matching `/m/pnl`'s own
 * choice: bouncing to a desktop path from a phone request sends it straight
 * back through the middleware for an extra hop.
 */
export default async function MobileLaborPage({
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
  // which calendar day "today" is.
  const today = new Date()
  const counterParams = readCounterParams(params, today)

  // NOT AWAITED — one promise per section, each unwrapped inside its own
  // Suspense boundary by `Section`. There is no `comparisonId` in this call:
  // `LaborSectionsInput` has no such field, the same as the desk page.
  const sections = getLaborSectionPromises({
    range: counterParams.range,
    storeId: counterParams.storeId,
    accountId: session.user.accountId,
    today,
  })

  return (
    <>
      <CounterPhoneLaborClient
        // PLAIN TEXT, not the URLSearchParams above: a class instance crosses
        // the RSC boundary with its prototype stripped.
        params={params.toString()}
        today={today}
        sections={sections}
      />
      {/*
       * The perf harness's marker (`scripts/mobile-transition-perf.ts`). See
       * `(mobile)/m/(counter)/pnl/page.tsx`'s own note on why this is a
       * hidden sibling and not a wrapper around the island.
       */}
      <span hidden data-perf-ready="/m/labor" />
    </>
  )
}
