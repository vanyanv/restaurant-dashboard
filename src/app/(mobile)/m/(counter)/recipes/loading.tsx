"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** Mirrors the real page's first tab: same sections, order and bare flags. */
export default function MobileRecipesLoading() {
  return (
    <>
      <Section bare title="Recipes" data={loading()}>
        {() => null}
      </Section>
      <Section bare title="Recipes in a sentence" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
