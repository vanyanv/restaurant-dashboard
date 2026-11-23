"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/**
 * Overview's content-only loading boundary (Task 2).
 *
 * With the chrome moved to `(counter)/layout.tsx` (Task 1), a layout
 * survives this navigation and only `children` — this slot — needs
 * something to show while the page's data resolves. `"use client"` is
 * required here because `Section` calls `useId()`, which is unavailable to
 * a plain Server Component; every other Counter page island already pays
 * this cost the same way.
 *
 * Built from `Section` itself rather than a second skeleton component:
 * passing `loading()` as a section's `data` makes `Section` render the same
 * `Skeleton` it already renders for a real section stuck loading, under the
 * same title, in the same position. Two different loading appearances in
 * one product would be worse than none, so this is the only sanctioned way
 * to build one. The order and titles below mirror
 * `counter-overview-client.tsx`'s own section order, so the shape a reader
 * sees here roughly matches what replaces it.
 */
export default function DashboardLoading() {
  return (
    <>
      {/* The Summary tab, in its order: the plain block (sentence, sales,
          statuses, store cards), where sales came from, then Needs you. This
          listed the pre-2026-11-18 page (net sales, verdict, strip...), so
          the skeleton a reader saw was replaced by a different shape. */}
      <Section bare title="How the period went" data={loading()}>
        {() => null}
      </Section>
      <Section bare title="Where sales came from" data={loading()}>
        {() => null}
      </Section>
      <Section bare title="Needs you" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
