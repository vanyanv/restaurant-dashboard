"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** The phone store-file loading boundary. */
export default function Loading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="The four inputs" data={loading()}>
        {() => null}
      </Section>
      <Section title="Fixed expenses" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
