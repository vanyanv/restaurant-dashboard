"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** The phone count-session loading boundary. */
export default function Loading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="What was counted" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
