"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"
import { InvoicesHead } from "../invoices-ui"

/** Prices' loading boundary. */
export default function InvoicePricesLoading() {
  return (
    <>
      <InvoicesHead sub="Loading" />
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="What moved" data={loading()} pad={false}>
        {() => null}
      </Section>
    </>
  )
}
