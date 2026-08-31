"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** The phone start-a-count loading boundary. */
export default function Loading() {
  return (
    <>
      <Section title="Areas" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
