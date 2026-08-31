"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** Costs' loading boundary. */
export default function Loading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="Spend by day" data={loading()}>
        {() => null}
      </Section>
      <Section title="By feature" data={loading()} pad={false}>
        {() => null}
      </Section>
      <Section title="Turns that were not OK" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
