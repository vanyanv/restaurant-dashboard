"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** Menu profit's phone loading boundary — the three entries the client renders. */
export default function MobileMenuProfitLoading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="Profit by item" data={loading()}>
        {() => null}
      </Section>
      <Section title="The four groups" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
