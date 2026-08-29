"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** The phone's monitoring loading boundary — the three entries the client renders. */
export default function MobileMonitoringLoading() {
  return (
    <>
      <Section bare title="Monitoring" data={loading()}>
        {() => null}
      </Section>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="Subsystems" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
