"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** Product usage' loading boundary — the four entries the client renders. */
export default function ProductUsageLoading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="Where the variance sits" data={loading()} pad={false}>
        {() => null}
      </Section>
      <div className="split">
        <Section title="Theoretical against purchased" data={loading()}>
          {() => null}
        </Section>
        <Section title="What to do" data={loading()}>
          {() => null}
        </Section>
      </div>
    </>
  )
}
