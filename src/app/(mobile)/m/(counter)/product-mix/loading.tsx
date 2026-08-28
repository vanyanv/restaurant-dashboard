"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** Product mix's phone loading boundary — the two entries the client renders. */
export default function MobileProductMixLoading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="Units by item" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
