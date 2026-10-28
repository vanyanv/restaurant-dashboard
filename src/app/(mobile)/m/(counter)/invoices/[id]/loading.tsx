"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** The invoice page's loading boundary — the sections the client renders. */
export default function InvoiceLoading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <div className="split">
        <Section title="The invoice" data={loading()}>
          {() => null}
        </Section>
        <Section title="What we checked" data={loading()} pad={false}>
          {() => null}
        </Section>
      </div>
      <Section title="Lines" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
