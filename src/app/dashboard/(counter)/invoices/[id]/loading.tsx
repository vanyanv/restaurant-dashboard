"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** Mirrors the real page's first tab: same sections, order and bare flags. */
export default function InvoiceLoading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section bare title="Decision" data={loading()}>
        {() => null}
      </Section>
      <Section title="The invoice" data={loading()}>
        {() => null}
      </Section>
      <Section title="What we checked" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
