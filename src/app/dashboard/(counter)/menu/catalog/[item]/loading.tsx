"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** Mirrors the real page's first tab: same sections, order and bare flags. */
export default function MenuItemLoading() {
  return (
    <Section bare title="This item in a sentence" data={loading()}>
      {() => null}
    </Section>
  )
}
