"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** The phone's counts loading boundary — the three entries the client renders. */
export default function MobileCountsLoading() {
  return (
    <>
      <Section bare title="Stock counts" data={loading()}>
        {() => null}
      </Section>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="Sessions" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
