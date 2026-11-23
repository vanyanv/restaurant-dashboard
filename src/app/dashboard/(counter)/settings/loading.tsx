"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** Mirrors the real page's first tab: same sections, order and bare flags. */
export default function Loading() {
  return (
    <>
      <Section title="Account" data={loading()}>
        {() => null}
      </Section>
      <Section title="Who can see this" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
