"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/**
 * The phone P&L's content-only loading boundary (Task 2).
 *
 * This file used to be `MobileRouteLoading` (`@/components/mobile/mobile-
 * loading`) — the pre-Counter editorial skeleton, carried over verbatim by
 * the `git mv` that graduated `/m/pnl` out of `(editorial)` in Task 1. It
 * drew its own toolbar and page-head skeleton, which duplicated chrome the
 * `(counter)` layout now owns, and it used the editorial `m-skel-*` visual
 * rather than Counter's `Skeleton` — exactly the second loading appearance
 * this task exists to prevent. Replaced with the same `Section`-built
 * pattern as every other Counter route's `loading.tsx`; see
 * `(mobile)/m/(counter)/loading.tsx` for why that is `"use client"`. Order
 * mirrors `counter-phone-pnl-client.tsx`'s own: the two-cell strip, the
 * cascade, the six weeks, then the statement.
 */
export default function MobilePnLLoading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="Where it went" data={loading()}>
        {() => null}
      </Section>
      <Section title="Week by week" data={loading()}>
        {() => null}
      </Section>
      <Section title="The statement" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
