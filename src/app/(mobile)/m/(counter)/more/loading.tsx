"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** The phone More loading boundary. */
export default function Loading() {
  return (
    <>
      <Section title="Notifications" data={loading()}>
        {() => null}
      </Section>
      <Section title="More" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
