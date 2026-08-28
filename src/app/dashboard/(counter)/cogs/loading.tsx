"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/**
 * COGS' content-only loading boundary.
 *
 * See `(counter)/loading.tsx` for why this is `"use client"` (`Section` calls
 * `useId()`) and why it is built from `Section` rather than a second skeleton:
 * passing `loading()` renders the same `Skeleton`, under the same title, in the
 * same box the resolved section will occupy, so there is exactly one loading
 * appearance in the product.
 *
 * Order and titles mirror `counter-cogs-client.tsx`'s own — the bare strip,
 * the plan chart, the `.split` pair, then the item table — so the shape a
 * reader sees here is the shape that replaces it.
 */
export default function CogsLoading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="Food cost against plan" data={loading()}>
        {() => null}
      </Section>
      <div className="split">
        <Section title="What moved" data={loading()}>
          {() => null}
        </Section>
        <Section title="By menu category" data={loading()}>
          {() => null}
        </Section>
      </div>
      <Section title="The items costing the most" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
