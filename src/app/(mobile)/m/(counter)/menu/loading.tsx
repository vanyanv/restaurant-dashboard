"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/**
 * The Menu hub's phone loading boundary. Two entries, which is where
 * `P.menuhub.phone()` stops — the category ring is desk-only.
 */
export default function MobileMenuLoading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="Where to work" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
