"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** The phone's invoice loading boundary — the four entries the client renders. */
export default function MobileInvoicesLoading() {
  return (
    <>
      <Section bare title="Invoices" data={loading()}>
        {() => null}
      </Section>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="Needs a look" data={loading()}>
        {() => null}
      </Section>
      <Section title="Settled" data={loading()}>
        {() => null}
      </Section>
      <Section bare title="Invoices that need you" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
