"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** Stock counts' loading boundary — the three entries the client renders. */
export default function CountsLoading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="Sessions" data={loading()} pad={false}>
        {() => null}
      </Section>
      <Section title="Variance" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
