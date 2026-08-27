"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/**
 * P&L's content-only loading boundary (Task 2). See `(counter)/loading.tsx`
 * for why this is `"use client"` and why it is built from `Section` rather
 * than a second skeleton. Shape mirrors `counter-pnl-client.tsx`'s own
 * section order: the strip, the cascade, the eight weeks, the statement, the
 * `.split` pair of owed sections, then the store table.
 */
export default function PnlLoading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="Where it went" data={loading()}>
        {() => null}
      </Section>
      <Section title="The last eight weeks" data={loading()}>
        {() => null}
      </Section>
      <Section title="The statement" data={loading()}>
        {() => null}
      </Section>
      <div className="split">
        <Section title="What is behind the food line" data={loading()}>
          {() => null}
        </Section>
        <Section title="How much of this is measured" data={loading()}>
          {() => null}
        </Section>
      </div>
      <Section title="By store" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
