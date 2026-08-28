"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** The phone vendor's loading boundary — the three entries the client renders. */
export default function MobileVendorLoading() {
  return (
    <>
      <Section bare title="Vendor" data={loading()}>
        {() => null}
      </Section>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="Invoices" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
