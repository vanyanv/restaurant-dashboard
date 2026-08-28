"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** The invoice record's loading boundary — the six entries the client renders. */
export default function InvoiceLoading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <div className="split">
        <Section title="The document" data={loading()}>
          {() => null}
        </Section>
        <Section title="Why this is in review" data={loading()}>
          {() => null}
        </Section>
      </div>
      <Section title="What was extracted" data={loading()} pad={false}>
        {() => null}
      </Section>
      <div className="split">
        <Section title="How it got here" data={loading()}>
          {() => null}
        </Section>
        <Section title="What we store" data={loading()}>
          {() => null}
        </Section>
        <Section title="Matching" data={loading()}>
          {() => null}
        </Section>
      </div>
    </>
  )
}
