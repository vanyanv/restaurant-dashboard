"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/**
 * COGS' phone content-only loading boundary.
 *
 * See `(counter)/loading.tsx` for why this is `"use client"` (`Section` calls
 * `useId()`) and why it is built from `Section` rather than a second
 * skeleton. Order and titles mirror `counter-phone-cogs-client.tsx`'s own:
 * the bare strip, the plan chart, then "What moved" — the same three-entry
 * shape the phone composition stops at (the category ring and the item table
 * are desk-only; see the client's own departure table).
 */
export default function MobileCogsLoading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="Against plan" data={loading()}>
        {() => null}
      </Section>
      <Section title="What moved" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
