"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/**
 * The alert inbox's content-only loading boundary.
 *
 * See `(counter)/loading.tsx` for why this is `"use client"` (`Section` calls
 * `useId()`) and why it is built from `Section` rather than a second skeleton:
 * passing `loading()` renders the same `Skeleton`, under the same title, in
 * the same box the resolved section will occupy, so there is exactly one
 * loading appearance in the product.
 *
 * Order and titles mirror `counter-alerts-client.tsx`'s own, including the
 * headless `.sec` that holds the two filter rows and the table, so the shape a
 * reader sees here is the shape that replaces it.
 */
export default function AlertsLoading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <div className="sec">
        <Section bare title="Filters" data={loading()}>
          {() => null}
        </Section>
        <Section bare title="Alerts" data={loading()}>
          {() => null}
        </Section>
      </div>
      <Section title="Alerts opened" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
