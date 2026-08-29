"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** New store's loading boundary. */
export default function Loading() {
  return (
    <>
      <Section title="The store" data={loading()}>
        {() => null}
      </Section>
      <Section title="What each field switches on" data={loading()}>
        {() => null}
      </Section>
      <Section title="Where the stores you have stand" data={loading()} pad={false}>
        {() => null}
      </Section>
    </>
  )
}
