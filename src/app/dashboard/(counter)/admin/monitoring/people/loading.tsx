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
      <Section title="Who opens it" data={loading()} pad={false}>
        {() => null}
      </Section>
      <Section title="Which pages get opened" data={loading()} pad={false}>
        {() => null}
      </Section>
    </>
  )
}
