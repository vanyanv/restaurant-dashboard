"use client"

import { Section } from "@/components/counter"
import { InvoicesHead } from "./invoices-ui"
import { loading } from "@/lib/counter/section-data"

/** Mirrors the top of the real page: same sections, order and bare flags. */
export default function InvoicesLoading() {
  return (
    <>
      <InvoicesHead sub="Loading" />
      <Section bare title="This week" data={loading()}>
        {() => null}
      </Section>
      <Section title="Needs you" data={loading()}>
        {() => null}
      </Section>
      <Section title="What came in" data={loading()}>
        {() => null}
      </Section>
      <Section title="Prices that changed" data={loading()}>
        {() => null}
      </Section>
      <Section title="Who you paid" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
