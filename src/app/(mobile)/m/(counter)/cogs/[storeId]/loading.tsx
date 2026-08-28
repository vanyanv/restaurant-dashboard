"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/**
 * One store's COGS on a phone, content-only loading boundary.
 *
 * Same construction and reason as `../loading.tsx`. Order and titles mirror
 * `counter-phone-store-cogs-client.tsx`: the store note and strip, the plan
 * chart against this store's own target. TWO entries, which is where
 * `P.cogsstore.phone()` stops — the movement table is desk-only on this route
 * (see the client's own note on the four extra landmarks it cost).
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
    </>
  )
}
