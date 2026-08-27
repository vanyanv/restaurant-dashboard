"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/**
 * The phone Orders list's content-only loading boundary (Task 2). See
 * `(mobile)/m/(counter)/loading.tsx` for why this is `"use client"` and why
 * it is built from `Section`. Order mirrors
 * `counter-phone-orders-client.tsx`'s own: the two-cell strip, then the
 * latest-orders list.
 */
export default function MobileOrdersLoading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="Latest" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
