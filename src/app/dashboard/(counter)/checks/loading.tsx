"use client"

import { Section } from "@/components/counter"
import { ChecksHead } from "./checks-ui"
import { loading } from "@/lib/counter/section-data"

/** Mirrors the top of the real page: same sections, order and bare flags. */
export default function Loading() {
  return (
    <>
      <ChecksHead sub="Loading" />
      <Section bare title="Store checks, made plain" data={loading()}>
        {() => null}
      </Section>
      <Section title="Today" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
