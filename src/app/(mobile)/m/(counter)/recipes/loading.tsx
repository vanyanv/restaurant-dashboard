"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** The phone's recipes loading boundary — the four entries the client renders. */
export default function MobileRecipesLoading() {
  return (
    <>
      <Section bare title="Recipes" data={loading()}>
        {() => null}
      </Section>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="Worst first" data={loading()}>
        {() => null}
      </Section>
      <Section bare title="Needs confirming" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
