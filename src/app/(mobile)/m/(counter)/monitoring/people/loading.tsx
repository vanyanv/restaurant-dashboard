"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** The phone people loading boundary. */
export default function Loading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="Who opens it" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
