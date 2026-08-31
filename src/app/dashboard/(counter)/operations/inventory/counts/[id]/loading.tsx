"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** The count session's loading boundary — the four entries the client renders. */
export default function CountSessionLoading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="What was counted" data={loading()} pad={false}>
        {() => null}
      </Section>
      <Section title="Variance" data={loading()}>
        {() => null}
      </Section>
      <Section title="What to do" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
