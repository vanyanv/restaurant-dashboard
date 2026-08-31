"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** The phone's stores loading boundary — the two entries the client renders. */
export default function MobileStoresLoading() {
  return (
    <>
      <Section bare title="Stores" data={loading()}>
        {() => null}
      </Section>
      <Section title="Locations" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
