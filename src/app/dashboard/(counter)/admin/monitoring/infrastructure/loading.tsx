"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** Infrastructure's loading boundary. Each panel resolves on its own. */
export default function Loading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="Scheduled jobs" data={loading()} pad={false}>
        {() => null}
      </Section>
      <Section title="Errors" data={loading()} pad={false}>
        {() => null}
      </Section>
      <Section title="What the database is made of" data={loading()} pad={false}>
        {() => null}
      </Section>
      <Section title="Files" data={loading()}>
        {() => null}
      </Section>
      <Section title="What this page cannot tell you" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
