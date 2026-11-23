"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** Mirrors the top of the real page: same sections, order and bare flags. */
export default function MobileStoresLoading() {
  return (
    <>
      <Section bare title="Stores" data={loading()}>
        {() => null}
      </Section>
      <Section title="Locations" data={loading()}>
        {() => null}
      </Section>
      <Section bare title="Open a store file" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
