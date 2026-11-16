"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"
import { CountHead } from "@/app/dashboard/(counter)/count/count-ui"

/** The phone count's loading boundary. */
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
