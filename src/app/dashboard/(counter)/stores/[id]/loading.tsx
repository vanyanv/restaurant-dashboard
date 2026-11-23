"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** Mirrors the top of the real page: same sections, order and bare flags. */
export default function StoreFileLoading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section bare title="Your inputs" data={loading()}>
        {() => null}
      </Section>
      <Section title="How this is worked out" data={loading()}>
        {() => null}
      </Section>
      <Section title="Where each input lands" data={loading()}>
        {() => null}
      </Section>
      <Section title="Location" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
