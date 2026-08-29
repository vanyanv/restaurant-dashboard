"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** The store file's loading boundary — the three entries the client renders. */
export default function StoreFileLoading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <div className="split">
        <Section title="Fixed cost" data={loading()}>
          {() => null}
        </Section>
        <Section title="Trading inputs" data={loading()}>
          {() => null}
        </Section>
        <Section title="Where it is" data={loading()}>
          {() => null}
        </Section>
      </div>
      <Section title="Set the inputs" data={loading()}>
        {() => null}
      </Section>
      <Section title="Needs you" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
