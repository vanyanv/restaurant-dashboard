"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** The ingredient audit's loading boundary. */
export default function Loading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="Not ingredients" data={loading()} pad={false}>
        {() => null}
      </Section>
      <Section title="What the ladder decided" data={loading()} pad={false}>
        {() => null}
      </Section>
      <Section title="Still unmatched" data={loading()} pad={false}>
        {() => null}
      </Section>
      <Section title="Spellings held together" data={loading()} pad={false}>
        {() => null}
      </Section>
    </>
  )
}
