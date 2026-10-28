"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"
import { InvoicesHead } from "@/app/dashboard/(counter)/invoices/invoices-ui"

/** Needs you's loading boundary: the tabs stay put while the queue loads. */
export default function InvoicesLoading() {
  return (
    <>
      <InvoicesHead sub="Loading" />
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="To review" data={loading()} pad={false}>
        {() => null}
      </Section>
      <Section title="Prices that moved" data={loading()} pad={false}>
        {() => null}
      </Section>
    </>
  )
}
