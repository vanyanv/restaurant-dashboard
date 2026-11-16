"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"
import { CountHead } from "@/app/dashboard/(counter)/count/count-ui"

/** The phone one-item page's loading boundary. */
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
