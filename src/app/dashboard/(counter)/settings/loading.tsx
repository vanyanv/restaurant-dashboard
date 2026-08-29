"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** Settings' loading boundary — each panel resolves on its own. */
export default function Loading() {
  return (
    <>
      <Section title="Account" data={loading()}>
        {() => null}
      </Section>
      <Section title="Notifications" data={loading()}>
        {() => null}
      </Section>
      <Section title="Where sign-ins came from" data={loading()} pad={false}>
        {() => null}
      </Section>
      <Section title="Preferences" data={loading()}>
        {() => null}
      </Section>
      <Section title="Who can see this" data={loading()} pad={false}>
        {() => null}
      </Section>
    </>
  )
}
