"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** Mirrors the top of the real page: same sections, order and bare flags. */
export default function RecipeLoading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="The recipe" data={loading()}>
        {() => null}
      </Section>
      <Section title="Add an ingredient" data={loading()}>
        {() => null}
      </Section>
      <Section title="What it costs" data={loading()}>
        {() => null}
      </Section>
      <Section title="Sells as" data={loading()}>
        {() => null}
      </Section>
      <Section title="Cost per serving" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
