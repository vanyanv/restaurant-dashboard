"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** Start a count's loading boundary. */
export default function Loading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="Counts already open" data={loading()} pad={false}>
        {() => null}
      </Section>
      <Section title="What to count" data={loading()}>
        {() => null}
      </Section>
      <Section title="The sheet" data={loading()} pad={false}>
        {() => null}
      </Section>
    </>
  )
}
