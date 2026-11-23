"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** Mirrors the real page's first tab: same sections, order and bare flags. */
export default function IngredientLoading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="Price history" data={loading()}>
        {() => null}
      </Section>
      <Section title="What this costs" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
