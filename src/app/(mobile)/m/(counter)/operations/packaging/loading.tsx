"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** The phone's packaging loading boundary — the three entries the client renders. */
export default function MobilePackagingLoading() {
  return (
    <>
      <Section bare title="Packaging" data={loading()}>
        {() => null}
      </Section>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="Containers" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
