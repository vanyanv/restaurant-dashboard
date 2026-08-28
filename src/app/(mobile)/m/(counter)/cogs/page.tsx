import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { readCounterParams } from "@/lib/counter/url-state"
import { getCogsSectionPromises } from "@/lib/counter/adapters/cogs"
import { CounterPhoneCogsClient } from "./counter-phone-cogs-client"

export const dynamic = "force-dynamic"

/**
 * Counter COGS — the group page, on a phone.
 *
 * `src/proxy.ts` rewrites `/dashboard/cogs` to `/m/cogs` on a phone
 * user agent — a mapping this task ADDS; the key was simply missing before
 * it, so a phone reader landing on `/dashboard/cogs` stayed on the desk page
 * with no route of its own to redirect to. There is no mobile COGS route
 * today, so nothing is being replaced.
 *
 * It is a near-copy of `src/app/dashboard/(counter)/cogs/page.tsx` on
 * purpose, and the part that must stay identical is the middle: ONE
 * `getCogsSectionPromises` call, with the range and store read off the same
 * `readCounterParams`. Two surfaces asking two different loaders for "what
 * the food cost" is how one restaurant ends up with two food-cost
 * percentages for one week; here they cannot, because there is one adapter
 * and it is this one.
 *
 * ## The owner gate
 *
 * Same ruling as the desk page's own note: every section this page reads is
 * money — the food-cost percentage over the statement's own Total Sales, the
 * ingredient prices that moved, and what the store is running against its
 * own published plan. `hasOwnerAccess` gates the whole route, same as
 * `/dashboard/cogs`. The redirect target is `/m/more` — the phone's
 * settings — rather than `/dashboard/settings`, matching `/m/labor`'s own
 * choice: bouncing to a desktop path from a phone request sends it straight
 * back through the middleware for an extra hop.
 */
export default async function MobileCogsPage({
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

  // Resolved once, here, and passed to the params reader — a moving
  // `new Date()` re-evaluated in two places could disagree about which
  // calendar day "today" is.
  const today = new Date()
  const counterParams = readCounterParams(params, today)

  // NOT AWAITED — one promise per section, each unwrapped inside its own
  // Suspense boundary by `Section`. There is no `comparisonId` in this call:
  // `CogsSectionsInput` has no such field, the same as the desk page.
  const sections = getCogsSectionPromises({
    range: counterParams.range,
    storeId: counterParams.storeId,
    accountId: session.user.accountId,
  })

  return (
    <>
      <CounterPhoneCogsClient
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
      <span hidden data-perf-ready="/m/cogs" />
    </>
  )
}
