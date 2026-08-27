"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/**
 * The phone order detail's content-only loading boundary (Task 2). See
 * `(mobile)/m/(counter)/loading.tsx` for why this is `"use client"` and why
 * it is built from `Section`. Order mirrors
 * `counter-phone-order-client.tsx`'s own: the two-cell strip, Items, then
 * What you keep.
 */
export default function MobileOrderLoading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="Items" data={loading()}>
        {() => null}
      </Section>
      <Section title="What you keep" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
