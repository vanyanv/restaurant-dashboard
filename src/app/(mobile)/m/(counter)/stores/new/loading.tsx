"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** Mirrors the top of the real page: same sections, order and bare flags. */
export default function Loading() {
  return (
    <>
      <Section bare title="The store" data={loading()}>
        {() => null}
      </Section>
      <Section title="Before it opens" data={loading()}>
        {() => null}
      </Section>
      <Section bare title="Create" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
