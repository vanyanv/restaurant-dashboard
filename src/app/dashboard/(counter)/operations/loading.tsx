"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** Operations' loading boundary — the three entries the client renders. */
export default function OperationsLoading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <div className="split">
        <Section title="Needs you across operations" data={loading()}>
          {() => null}
        </Section>
        <Section title="The areas" data={loading()} pad={false}>
          {() => null}
        </Section>
      </div>
    </>
  )
}
