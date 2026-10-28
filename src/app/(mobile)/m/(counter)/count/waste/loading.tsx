"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** The phone waste log's loading boundary. */
export default function Loading() {
  return (
    <Section title="Log waste" data={loading()}>
      {() => null}
    </Section>
  )
}
