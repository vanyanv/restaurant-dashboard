"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** The phone new-store loading boundary. */
export default function Loading() {
  return (
    <>
      <Section bare title="The store" data={loading()}>
        {() => null}
      </Section>
      <Section title="Before it opens" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
