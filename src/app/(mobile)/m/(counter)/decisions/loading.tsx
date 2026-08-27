"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/**
 * The phone week's content-only loading boundary.
 *
 * See `(mobile)/m/(counter)/loading.tsx` for why this is `"use client"` and
 * why it is built from `Section` rather than a second skeleton. Order mirrors
 * `counter-phone-decisions-client.tsx`'s own: the two-cell strip, the week's
 * bars, the three-row list, then the primary button.
 */
export default function MobileDecisionsLoading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="The call this week" data={loading()}>
        {() => null}
      </Section>
      <Section title="What to do" data={loading()}>
        {() => null}
      </Section>
      <Section bare title="Commit the first one" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
