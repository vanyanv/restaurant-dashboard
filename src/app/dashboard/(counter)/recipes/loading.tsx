"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** Recipes' loading boundary — the four entries the client renders. */
export default function RecipesLoading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="All recipes" data={loading()} pad={false}>
        {() => null}
      </Section>
      <div className="split">
        <Section title="Needs confirming" data={loading()}>
          {() => null}
        </Section>
        <Section title="Component recipes" data={loading()} pad={false}>
          {() => null}
        </Section>
      </div>
    </>
  )
}
