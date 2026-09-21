"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/**
 * The ingredient detail's loading boundary — the five entries the client
 * renders above its cost form, in the client's own order.
 */
export default function IngredientLoading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="Price history" data={loading()}>
        {() => null}
      </Section>
      <Section title="Deliveries" data={loading()} pad={false}>
        {() => null}
      </Section>
      <div className="split">
        <Section title="Matched SKUs" data={loading()} pad={false}>
          {() => null}
        </Section>
        <Section title="Used in" data={loading()} pad={false}>
          {() => null}
        </Section>
      </div>
    </>
  )
}
