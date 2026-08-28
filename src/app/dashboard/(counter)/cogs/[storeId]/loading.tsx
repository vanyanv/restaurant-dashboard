"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/**
 * One store's COGS, content-only loading boundary.
 *
 * Same construction and same reason as `../loading.tsx`: built from `Section`
 * with `loading()` rather than a second skeleton, so there is exactly one
 * loading appearance in the product.
 *
 * Order and titles mirror `counter-store-cogs-client.tsx` — the store note and
 * strip, the plan chart, then the `.split` pair. Four sections, not the group
 * page's five: this route has no category ring, because the ring answers a
 * question about the whole account's menu and does not change per store.
 */
export default function StoreCogsLoading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="Food cost against this store's target" data={loading()}>
        {() => null}
      </Section>
      <div className="split">
        <Section title="What moved" data={loading()}>
          {() => null}
        </Section>
        <Section title="Worst margin items" data={loading()}>
          {() => null}
        </Section>
      </div>
    </>
  )
}
