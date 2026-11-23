"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/**
 * The phone Overview's content-only loading boundary (Task 2).
 *
 * `.ct-root.ct-phone`, `.mtop` and `.mscroll` are
 * `(mobile)/m/(counter)/layout.tsx`'s now, so only what goes inside
 * `.mscroll` needs a skeleton. `"use client"` is required because `Section`
 * calls `useId()`, unavailable to a plain Server Component.
 *
 * Built from `Section` itself rather than a second skeleton: passing
 * `loading()` as a section's `data` makes it render the same `Skeleton` a
 * real stuck section would, under the same title. Order mirrors
 * `counter-phone-overview-client.tsx`'s own section order.
 */
export default function MobileOverviewLoading() {
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
