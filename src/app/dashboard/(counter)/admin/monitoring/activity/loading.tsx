"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** Mirrors the real page's first tab: same sections, order and bare flags. */
export default function Loading() {
  return (
    <>
      <Section bare title="Verdict" data={loading()}>
        {() => null}
      </Section>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="Errors by hour" data={loading()}>
        {() => null}
      </Section>
      <Section title="Recent errors" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
