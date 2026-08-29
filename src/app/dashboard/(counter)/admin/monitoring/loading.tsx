"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** Monitoring's loading boundary — the four entries the client renders. */
export default function MonitoringLoading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="The other pages" data={loading()} pad={false}>
        {() => null}
      </Section>
      <Section title="Subsystems" data={loading()} pad={false}>
        {() => null}
      </Section>
      <Section title="Recent events" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
