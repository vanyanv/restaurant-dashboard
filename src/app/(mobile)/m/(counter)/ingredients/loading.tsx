"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** The phone's ingredients loading boundary — the five entries the client renders. */
export default function MobileIngredientsLoading() {
  return (
    <>
      <Section bare title="Ingredients" data={loading()}>
        {() => null}
      </Section>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="Price monitor" data={loading()}>
        {() => null}
      </Section>
      <Section title="Moving most" data={loading()}>
        {() => null}
      </Section>
      <Section bare title="Go" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
