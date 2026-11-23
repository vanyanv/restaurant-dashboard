"use client"

import { Section } from "@/components/counter"
import { InvoicesHead } from "../invoices-ui"
import { loading } from "@/lib/counter/section-data"

/** Mirrors the top of the real page: same sections, order and bare flags. */
export default function InvoicePricesLoading() {
  return (
    <>
      <InvoicesHead sub="Loading" />
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="Ranked by what it costs you" data={loading()}>
        {() => null}
      </Section>
      <Section title="The three biggest moves in dollars, by week" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
