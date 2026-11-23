"use client"

import { PageHead, Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** Mirrors the top of the real page: same sections, order and bare flags. */
export default function Loading() {
  return (
    <>
      <PageHead title="People" sub="Who can sign in, and who is waiting on a link · developer only" />
      <Section bare title="People" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
