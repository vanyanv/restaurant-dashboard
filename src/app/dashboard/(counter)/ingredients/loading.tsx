"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** Ingredients' loading boundary — the six entries the client renders. */
export default function IngredientsLoading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="Price monitor" data={loading()}>
        {() => null}
      </Section>
      <div className="split">
        <Section title="Catalogue" data={loading()} pad={false}>
          {() => null}
        </Section>
        <Section title="Review inbox" data={loading()}>
          {() => null}
        </Section>
        <Section title="Modifier mapping" data={loading()} pad={false}>
          {() => null}
        </Section>
      </div>
      <div className="split">
        <Section title="Needs review" data={loading()}>
          {() => null}
        </Section>
        <Section title="The pantry" data={loading()} pad={false}>
          {() => null}
        </Section>
      </div>
    </>
  )
}
