"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/**
 * One store's Analytics, on the phone — content-only loading boundary. See
 * `(counter)/loading.tsx` for why this is `"use client"` and why it is built
 * from `Section` rather than a second skeleton. Order mirrors
 * `counter-phone-store-analytics-client.tsx`'s own: the strip, the chart,
 * then the day book. There is no fourth entry — the desk sibling's "When the
 * orders come", "By channel", "Top items", "The statement" and "By category"
 * are not in `P.analyticsstore.phone()`'s composition, so a loading skeleton
 * for any of them would promise a panel the loaded page never draws.
 */
export default function MobileStoreAnalyticsLoading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="Net sales" data={loading()}>
        {() => null}
      </Section>
      <Section title="The day book" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
