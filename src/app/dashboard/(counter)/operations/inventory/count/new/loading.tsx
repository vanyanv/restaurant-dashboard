"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** Start a count's loading boundary — the three panels `P.countnew` has. */
export default function Loading() {
  return (
    <>
      <Section title="What to count" data={loading()}>
        {() => null}
      </Section>
      <Section title="The sheet" data={loading()} pad={false}>
        {() => null}
      </Section>
      <Section title="Then what" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
