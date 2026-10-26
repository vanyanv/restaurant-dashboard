"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"
import { ChecksHead } from "../checks-ui"

/** Store checks' loading boundary: the tabs stay put while the panel loads. */
export default function Loading() {
  return (
    <>
      <ChecksHead sub="Loading" />
      <Section title="Crew & PINs" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
