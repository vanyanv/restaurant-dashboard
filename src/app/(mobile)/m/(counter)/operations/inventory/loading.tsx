"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** The phone's inventory loading boundary — the four entries the client renders. */
export default function MobileInventoryLoading() {
  return (
    <>
      <Section bare title="Inventory" data={loading()}>
        {() => null}
      </Section>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="What a count would settle" data={loading()}>
        {() => null}
      </Section>
      <Section bare title="Go" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
