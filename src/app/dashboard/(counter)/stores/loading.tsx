"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** Stores' loading boundary — the four entries the client renders. */
export default function StoresLoading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="Store operating files" data={loading()} pad={false}>
        {() => null}
      </Section>
      <Section title="Needs you" data={loading()}>
        {() => null}
      </Section>
      <Section title="Add a store" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
