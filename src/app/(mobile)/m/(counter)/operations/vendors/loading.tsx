"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** The phone's vendors loading boundary — the four entries the client renders. */
export default function MobileVendorsLoading() {
  return (
    <>
      <Section bare title="Vendors" data={loading()}>
        {() => null}
      </Section>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="Price trend" data={loading()}>
        {() => null}
      </Section>
      <Section title="By spend" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
