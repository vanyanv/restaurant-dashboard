"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/**
 * One store's Analytics, content-only loading boundary. See
 * `(counter)/loading.tsx` for why this is `"use client"` and why it is built
 * from `Section` rather than a second skeleton. Shape mirrors
 * `counter-store-analytics-client.tsx`'s own section order: the strip, the two
 * `.split` pairs, the day book, then the last pair.
 */
export default function StoreAnalyticsLoading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <div className="split">
        <Section title="Net sales" data={loading()}>
          {() => null}
        </Section>
        <Section title="When the orders come" data={loading()}>
          {() => null}
        </Section>
      </div>
      <div className="split">
        <Section title="By channel" data={loading()}>
          {() => null}
        </Section>
        <Section title="Top items" data={loading()}>
          {() => null}
        </Section>
      </div>
      <Section title="The day book" data={loading()}>
        {() => null}
      </Section>
      <div className="split">
        <Section title="The statement" data={loading()}>
          {() => null}
        </Section>
        <Section title="By category" data={loading()}>
          {() => null}
        </Section>
      </div>
    </>
  )
}
