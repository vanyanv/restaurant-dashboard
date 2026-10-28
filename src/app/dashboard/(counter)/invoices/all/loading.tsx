"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"
import { InvoicesHead } from "../invoices-ui"

/** All invoices' loading boundary. */
export default function AllInvoicesLoading() {
  return (
    <>
      <InvoicesHead sub="Loading" />
      <Section title="Invoices" data={loading()} pad={false}>
        {() => null}
      </Section>
      <Section title="Spend" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
