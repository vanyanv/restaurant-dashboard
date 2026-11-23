"use client"

import { Section } from "@/components/counter"
import { ChecksHead } from "@/app/dashboard/(counter)/checks/checks-ui"
import { loading } from "@/lib/counter/section-data"

/** Mirrors the top of the real page: same sections, order and bare flags. */
export default function Loading() {
  return (
    <>
      <ChecksHead sub="Loading" />
      <Section title="Check emails" data={loading()}>
        {() => null}
      </Section>
      <Section title="Links & QR posters" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
