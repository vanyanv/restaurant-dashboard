"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/**
 * Labor's phone content-only loading boundary.
 *
 * See `(counter)/loading.tsx` for why this is `"use client"` (`Section` calls
 * `useId()`) and why it is built from `Section` rather than a second
 * skeleton. Order and titles mirror `counter-phone-labor-client.tsx`'s own:
 * the strip, the schedule chart, the role list, then the bare block holding
 * the primary button — the same four-entry shape `/m/decisions`' loading
 * state uses for the same reason.
 */
export default function MobileLaborLoading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="Scheduled vs actual" data={loading()}>
        {() => null}
      </Section>
      <Section title="By role" data={loading()}>
        {() => null}
      </Section>
      <Section bare title="Needs a decision" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
