"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** Mirrors the real page's first tab: same sections, order and bare flags. */
export default function MobileRecipeLoading() {
  return (
    <>
      <Section bare title="Recipe" data={loading()}>
        {() => null}
      </Section>
      <Section bare title="The recipe in a sentence" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
