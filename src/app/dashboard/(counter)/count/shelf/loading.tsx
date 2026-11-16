"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"
import { CountHead } from "../count-ui"

/** The Shelf tab's loading boundary. */
export default function Loading() {
  return (
    <>
      <CountHead sub="Loading" />
      <Section title="Shelf" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
