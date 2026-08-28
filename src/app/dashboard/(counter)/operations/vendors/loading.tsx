"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** Vendors' loading boundary — the four entries the client renders. */
export default function VendorsLoading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="Vendors" data={loading()} pad={false}>
        {() => null}
      </Section>
      <div className="split">
        <Section title="Price trend" data={loading()}>
          {() => null}
        </Section>
        <Section title="Worth a call" data={loading()}>
          {() => null}
        </Section>
      </div>
    </>
  )
}
