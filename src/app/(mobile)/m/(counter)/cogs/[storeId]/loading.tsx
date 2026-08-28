"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/**
 * One store's COGS on a phone, content-only loading boundary.
 *
 * Same construction and reason as `../loading.tsx`. Order and titles mirror
 * `counter-phone-store-cogs-client.tsx`: the store note and strip, the plan
 * chart against this store's own target, then what moved. Three entries, the
 * same shape the group phone page stops at — the category ring and the item
 * tables are desk-only.
 */
export default function MobileStoreCogsLoading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="Against this store's target" data={loading()}>
        {() => null}
      </Section>
      <Section title="What moved" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
