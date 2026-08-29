"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** The phone's product usage loading boundary — the three entries the client renders. */
export default function MobileProductUsageLoading() {
  return (
    <>
      <Section bare title="Product usage" data={loading()}>
        {() => null}
      </Section>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="Biggest gaps" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
