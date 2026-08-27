"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/**
 * Analytics' content-only loading boundary. See `(counter)/loading.tsx` for
 * why this is `"use client"` and why it is built from `Section` rather than a
 * second skeleton. Shape mirrors `counter-analytics-client.tsx`'s own section
 * order: the strip, the mix, then the `.split` pair.
 */
export default function AnalyticsLoading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="Channel mix" data={loading()}>
        {() => null}
      </Section>
      <div className="split">
        <Section title="By day of week" data={loading()}>
          {() => null}
        </Section>
        <Section title="When the orders come" data={loading()}>
          {() => null}
        </Section>
      </div>
    </>
  )
}
