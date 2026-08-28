"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** The catalog's phone loading boundary — the three entries the client renders. */
export default function MobileCatalogLoading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="Unmapped" data={loading()}>
        {() => null}
      </Section>
      <Section title="Top sellers" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
