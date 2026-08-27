"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/**
 * Orders' content-only loading boundary (Task 2). See `(counter)/loading.tsx`
 * for why this is `"use client"` and why it is built from `Section` rather
 * than a second skeleton. Shape mirrors `counter-orders-client.tsx`'s own
 * section order: the strip, the headless `.sec` wrapping the list, then the
 * hourly chart.
 */
export default function OrdersLoading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <div className="sec">
        <Section bare title="Orders" data={loading()}>
          {() => null}
        </Section>
      </div>
      <Section title="Orders by hour" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
