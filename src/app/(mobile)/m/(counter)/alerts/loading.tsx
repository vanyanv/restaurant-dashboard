"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/** Mirrors the real page's first tab: same sections, order and bare flags. */
export default function MobileAlertsLoading() {
  return (
    <>
      <Section bare title="Alerts" data={loading()}>
        {() => null}
      </Section>
      <Section bare title="Alerts in a sentence" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
