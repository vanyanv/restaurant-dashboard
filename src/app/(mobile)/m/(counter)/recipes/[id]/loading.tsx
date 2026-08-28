"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** The phone recipe's loading boundary — the four entries the client renders. */
export default function MobileRecipeLoading() {
  return (
    <>
      <Section bare title="Recipe" data={loading()}>
        {() => null}
      </Section>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="What it costs" data={loading()}>
        {() => null}
      </Section>
      <Section title="The recipe" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
