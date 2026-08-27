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
      <Section bare title="Net sales" data={loading()}>
        {() => null}
      </Section>
      <Section bare title="Sales per labour hour" data={loading()}>
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
      <Section bare title="Every figure against the comparison" data={loading()}>
        {() => null}
      </Section>
      <Section title="What needs you" data={loading()}>
        {() => null}
      </Section>
      <Section title="Per-store ledger" data={loading()}>
        {() => null}
      </Section>
      <Section title="Invoices" data={loading()}>
        {() => null}
      </Section>
      <Section title="Guest ratings" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
