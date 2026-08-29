"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** The price monitor's loading boundary. */
export default function Loading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="What moved" data={loading()}>
        {() => null}
      </Section>
      <Section title="Ranked by what it costs you" data={loading()} pad={false}>
        {() => null}
      </Section>
      <Section title="Held out" data={loading()} pad={false}>
        {() => null}
      </Section>
    </>
  )
}
