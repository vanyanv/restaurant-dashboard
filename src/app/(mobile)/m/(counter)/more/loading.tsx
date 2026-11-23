"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** Mirrors the top of the real page: same sections, order and bare flags. */
export default function Loading() {
  return (
    <>
      <Section title="Stores" data={loading()}>
        {() => null}
      </Section>
      <Section title="Today" data={loading()}>
        {() => null}
      </Section>
      <Section title="Money" data={loading()}>
        {() => null}
      </Section>
      <Section title="Menu" data={loading()}>
        {() => null}
      </Section>
      <Section title="Stock and suppliers" data={loading()}>
        {() => null}
      </Section>
      <Section title="Notifications" data={loading()}>
        {() => null}
      </Section>
      <Section title="Appearance" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
