"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** Mirrors the top of the real page: same sections, order and bare flags. */
export default function Loading() {
  return (
    <>
      <Section bare title="People" data={loading()}>
        {() => null}
      </Section>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="Most opened" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
