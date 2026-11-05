"use client"

import { PageHead, Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** People's loading boundary: the title stays put while the list loads. */
export default function Loading() {
  return (
    <>
      <PageHead title="People" sub="Who can sign in, and who is waiting on a link · developer only" />
      <Section title="People" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
