"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** Inventory's loading boundary — the five entries the client renders. */
export default function InventoryLoading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="On hand" data={loading()} pad={false}>
        {() => null}
      </Section>
      <Section title="Coverage health" data={loading()}>
        {() => null}
      </Section>
      <div className="split">
        <Section title="Delivered, 8 weeks" data={loading()}>
          {() => null}
        </Section>
        <Section title="Next count" data={loading()}>
          {() => null}
        </Section>
      </div>
      <Section title="What a count would settle" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
