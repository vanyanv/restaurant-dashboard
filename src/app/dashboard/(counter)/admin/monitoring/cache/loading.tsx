"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** Cache's loading boundary. */
export default function Loading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="By prefix" data={loading()} pad={false}>
        {() => null}
      </Section>
    </>
  )
}
