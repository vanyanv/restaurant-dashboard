"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** Mirrors the real page's first tab: same sections, order and bare flags. */
export default function PnlLoading() {
  return (
    <>
      <Section bare title="What you kept" data={loading()}>
        {() => null}
      </Section>
      <Section title="Needs you" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
