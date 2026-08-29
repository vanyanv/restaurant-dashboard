"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** Model health's loading boundary. */
export default function Loading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="Forecast against actual" data={loading()}>
        {() => null}
      </Section>
      <Section title="Against the baseline" data={loading()} pad={false}>
        {() => null}
      </Section>
      <Section title="Gates" data={loading()} pad={false}>
        {() => null}
      </Section>
      <Section title="External signals" data={loading()} pad={false}>
        {() => null}
      </Section>
      <Section title="Training runs" data={loading()} pad={false}>
        {() => null}
      </Section>
    </>
  )
}
