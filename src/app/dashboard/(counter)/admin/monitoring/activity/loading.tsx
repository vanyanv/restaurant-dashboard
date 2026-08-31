"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** Activity's loading boundary. */
export default function Loading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="Errors by hour" data={loading()}>
        {() => null}
      </Section>
      <Section title="Recent errors" data={loading()}>
        {() => null}
      </Section>
      <Section title="Stores reporting" data={loading()} pad={false}>
        {() => null}
      </Section>
      <Section title="What happened" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
