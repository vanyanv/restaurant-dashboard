"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** The phone infrastructure loading boundary. */
export default function Loading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="Scheduled jobs" data={loading()}>
        {() => null}
      </Section>
      <Section title="Largest tables" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
