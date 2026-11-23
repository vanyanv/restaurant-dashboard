"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** Mirrors the top of the real page: same sections, order and bare flags. */
export default function Loading() {
  return (
    <>
      <Section bare title="Infrastructure" data={loading()}>
        {() => null}
      </Section>
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
