"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** Packaging's loading boundary — the three entries the client renders. */
export default function PackagingLoading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="Container ledger" data={loading()} pad={false}>
        {() => null}
      </Section>
      <Section title="Invoice validation" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
