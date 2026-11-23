"use client"

import { PageHead, Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** Screens' loading boundary. */
export default function Loading() {
  return (
    <>
      <PageHead title="Screens" sub="TV menu boards in every store" />
      <Section bare title="Screens" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
