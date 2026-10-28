"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"
import { CountHead } from "./count-ui"

/** Count & waste's loading boundary: the tabs stay put while the panel loads. */
export default function Loading() {
  return (
    <>
      <CountHead sub="Loading" />
      <Section title="Weekly count" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
