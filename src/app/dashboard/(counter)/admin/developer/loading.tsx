"use client"

import { PageHead, Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** Mirrors the page's first tab (Map): same sections, order and bare flags. */
export default function Loading() {
  return (
    <>
      <PageHead title="Developer portal" sub="Developer only · not visible to the owner" />
      <Section bare title="Developer portal" data={loading()}>
        {() => null}
      </Section>
      <Section bare title="Connections" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
