"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** The recipe builder's loading boundary — the five entries the client renders. */
export default function RecipeLoading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <div className="split">
        <Section title="The recipe" data={loading()}>
          {() => null}
        </Section>
        <Section title="What it costs" data={loading()}>
          {() => null}
        </Section>
        <Section title="Sells as" data={loading()} pad={false}>
          {() => null}
        </Section>
      </div>
      <Section title="Cost per serving" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
