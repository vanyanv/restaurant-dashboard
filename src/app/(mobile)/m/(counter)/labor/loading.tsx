"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** Mirrors the top of the real page: same sections, order and bare flags. */
export default function MobileLaborLoading() {
  return (
    <Section bare title="Labor in a sentence" data={loading()}>
      {() => null}
    </Section>
  )
}
