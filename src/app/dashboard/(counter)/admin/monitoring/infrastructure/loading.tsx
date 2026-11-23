"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** Mirrors the top of the real page: same sections, order and bare flags. */
export default function Loading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="Scheduled jobs" data={loading()}>
        {() => null}
      </Section>
      <Section title="Files" data={loading()}>
        {() => null}
      </Section>
      <Section title="What the database is made of" data={loading()}>
        {() => null}
      </Section>
      <Section bare title="What this page cannot tell you" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
