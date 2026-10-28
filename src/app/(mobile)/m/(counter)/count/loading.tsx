"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** The phone count's loading boundary. */
export default function Loading() {
  return (
    <Section title="Weekly count" data={loading()}>
      {() => null}
    </Section>
  )
}
