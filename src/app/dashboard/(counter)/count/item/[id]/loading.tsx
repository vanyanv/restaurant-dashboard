"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"
import { CountHead } from "../../count-ui"

/** The one-item page's loading boundary: the tabs stay put while the item loads. */
export default function Loading() {
  return (
    <>
      <CountHead sub="Loading" />
      <Section title="Item" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
