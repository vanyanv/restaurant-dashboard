"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** The vendor detail's loading boundary — the four entries the client renders. */
export default function VendorLoading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="Spend" data={loading()}>
        {() => null}
      </Section>
      <div className="split">
        <Section title="Invoices" data={loading()} pad={false}>
          {() => null}
        </Section>
        <Section title="The basket" data={loading()} pad={false}>
          {() => null}
        </Section>
      </div>
    </>
  )
}
