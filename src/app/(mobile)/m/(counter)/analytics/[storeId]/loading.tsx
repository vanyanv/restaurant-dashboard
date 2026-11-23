"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** Mirrors the real page's first tab: same sections, order and bare flags. */
export default function MobileStoreAnalyticsLoading() {
  return (
    <Section bare title="Where sales came from" data={loading()}>
      {() => null}
    </Section>
  )
}
