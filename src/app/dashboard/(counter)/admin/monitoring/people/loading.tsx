"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** People's loading boundary. */
export default function Loading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="Readings" data={loading()}>
        {() => null}
      </Section>
      <Section title="Which pages get opened" data={loading()} pad={false}>
        {() => null}
      </Section>
      <Section title="What this tells you" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
