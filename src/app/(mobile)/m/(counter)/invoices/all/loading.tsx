"use client"

import { Section } from "@/components/counter"
import { InvoicesHead } from "@/app/dashboard/(counter)/invoices/invoices-ui"
import { loading } from "@/lib/counter/section-data"

/** Mirrors the top of the real page: same sections, order and bare flags. */
export default function AllInvoicesLoading() {
  return (
    <>
      <InvoicesHead sub="Loading" />
      <Section title="Invoices" data={loading()}>
        {() => null}
      </Section>
      <Section title="Spend" data={loading()}>
        {() => null}
      </Section>
      <Section title="What the spend was on" data={loading()}>
        {() => null}
      </Section>
      <Section title="The files" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
