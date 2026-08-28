"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** The phone invoice's loading boundary — the four entries the client renders. */
export default function MobileInvoiceLoading() {
  return (
    <>
      <Section bare title="Invoice" data={loading()}>
        {() => null}
      </Section>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="The document" data={loading()}>
        {() => null}
      </Section>
      <Section title="Needs a decision" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
