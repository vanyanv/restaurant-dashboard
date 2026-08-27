"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/**
 * One order's content-only loading boundary (Task 2). See
 * `(counter)/loading.tsx` for why this is `"use client"` and why it is built
 * from `Section` rather than a second skeleton. Shape mirrors
 * `counter-order-client.tsx`'s own layout: the strip, then `.split` (Items /
 * What you keep), then `.tri` (Timeline / Platform / Needs you).
 */
export default function OrderLoading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <div className="split">
        <Section title="Items" data={loading()}>
          {() => null}
        </Section>
        <Section title="What you keep" data={loading()}>
          {() => null}
        </Section>
      </div>
      <div className="tri">
        <Section title="Timeline" data={loading()}>
          {() => null}
        </Section>
        <Section title="Platform" data={loading()}>
          {() => null}
        </Section>
        <Section title="Needs you" data={loading()}>
          {() => null}
        </Section>
      </div>
    </>
  )
}
