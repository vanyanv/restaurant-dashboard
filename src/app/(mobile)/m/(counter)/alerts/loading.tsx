"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/**
 * The phone inbox's content-only loading boundary.
 *
 * See `(mobile)/m/(counter)/loading.tsx` for why this is `"use client"` and
 * why it is built from `Section` rather than a second skeleton. Order mirrors
 * `counter-phone-alerts-client.tsx`'s own: the title block, the open list,
 * the acknowledged list.
 */
export default function MobileAlertsLoading() {
  return (
    <>
      <Section bare title="Alerts" data={loading()}>
        {() => null}
      </Section>
      <Section title="Open" data={loading()}>
        {() => null}
      </Section>
      <Section title="Acknowledged" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
