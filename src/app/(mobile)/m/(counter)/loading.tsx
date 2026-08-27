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
      <Section bare title="Net sales" data={loading()}>
        {() => null}
      </Section>
      <Section bare title="The verdict" data={loading()}>
        {() => null}
      </Section>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section bare title="Still moving" data={loading()}>
        {() => null}
      </Section>
      <Section title="Net sales" data={loading()}>
        {() => null}
      </Section>
      <Section title="Sales per labor hour" data={loading()}>
        {() => null}
      </Section>
      <Section title="Per store" data={loading()}>
        {() => null}
      </Section>
      <Section title="What needs you" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
