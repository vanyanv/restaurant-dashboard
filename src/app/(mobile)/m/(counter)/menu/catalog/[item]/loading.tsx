"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** The item page's phone loading boundary — the two entries the client renders. */
export default function MobileMenuItemLoading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="By channel" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
