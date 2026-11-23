"use client"

import { Section } from "@/components/counter"
import { CountHead } from "../../count-ui"
import { loading } from "@/lib/counter/section-data"

/** Mirrors the top of the real page: same sections, order and bare flags. */
export default function Loading() {
  return (
    <>
      <CountHead sub="Loading" />
      <Section bare title="Item" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
