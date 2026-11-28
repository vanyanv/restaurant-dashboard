"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** Mirrors the page's first tab (Map): same sections, order and bare flags. */
export default function Loading() {
  return (
    <>
      <div>
        <h2 className="mtitle">Developer portal</h2>
        <p className="msub">Developer only</p>
      </div>
      <Section bare title="Developer portal" data={loading()}>
        {() => null}
      </Section>
      <Section bare title="Connections" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
