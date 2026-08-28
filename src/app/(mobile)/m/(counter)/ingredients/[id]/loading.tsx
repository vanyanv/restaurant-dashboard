"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** The phone ingredient's loading boundary — the four entries the client renders. */
export default function MobileIngredientLoading() {
  return (
    <>
      <Section bare title="Ingredient" data={loading()}>
        {() => null}
      </Section>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="Price history" data={loading()}>
        {() => null}
      </Section>
      <Section title="Used in" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
