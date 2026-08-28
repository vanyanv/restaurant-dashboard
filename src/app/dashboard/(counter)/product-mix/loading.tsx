"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** Product mix's loading boundary — the four entries the client renders. */
export default function ProductMixLoading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="Units by item" data={loading()}>
        {() => null}
      </Section>
      <div className="split">
        <Section title="Mix against last period" data={loading()} pad={false}>
          {() => null}
        </Section>
        <Section title="What the mix cost you" data={loading()}>
          {() => null}
        </Section>
      </div>
    </>
  )
}
