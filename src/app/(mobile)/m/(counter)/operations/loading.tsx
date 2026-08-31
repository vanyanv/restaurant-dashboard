"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** The phone's operations loading boundary — the two entries the client renders. */
export default function MobileOperationsLoading() {
  return (
    <>
      <Section bare title="Operations" data={loading()}>
        {() => null}
      </Section>
      <Section title="Areas" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
