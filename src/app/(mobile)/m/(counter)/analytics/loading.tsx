"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/**
 * The phone Analytics' content-only loading boundary (Task 2). Built from
 * `Section` rather than a second skeleton — see `(counter)/loading.tsx` for
 * why this is `"use client"`. Order mirrors
 * `counter-phone-analytics-client.tsx`'s own: the strip, the mix, then the
 * day of week. There is no fourth entry for "When the orders come" — the
 * phone drops that section (it is not in `P.analytics.phone()`'s
 * composition), so a loading skeleton for it would promise a panel the
 * loaded page never draws.
 */
export default function MobileAnalyticsLoading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="Channel mix" data={loading()}>
        {() => null}
      </Section>
      <Section title="By day of week" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
