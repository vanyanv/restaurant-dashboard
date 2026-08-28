"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** Invoices' loading boundary — the five entries the client renders. */
export default function InvoicesLoading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <div className="sec">
        <Section bare title="Received" data={loading()}>
          {() => null}
        </Section>
      </div>
      <Section title="Spend" data={loading()}>
        {() => null}
      </Section>
      <div className="split">
        <Section title="What we hold" data={loading()}>
          {() => null}
        </Section>
        <Section title="Fix before approving" data={loading()}>
          {() => null}
        </Section>
      </div>
      <Section title="What the spend was on" data={loading()} pad={false}>
        {() => null}
      </Section>
    </>
  )
}
