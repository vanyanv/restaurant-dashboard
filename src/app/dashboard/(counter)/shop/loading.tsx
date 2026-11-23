"use client"

import { Section } from "@/components/counter"
import { ShopHead } from "./shop-ui"
import { loading } from "@/lib/counter/section-data"

/** Mirrors the top of the real page: same sections, order and bare flags. */
export default function Loading() {
  return (
    <>
      <ShopHead sub="Loading" />
      <Section bare title="Needs you" data={loading()}>
        {() => null}
      </Section>
      <Section title="To ship" data={loading()}>
        {() => null}
      </Section>
      <Section title="Pickup" data={loading()}>
        {() => null}
      </Section>
      <Section title="Sales, last 7 days" data={loading()}>
        {() => null}
      </Section>
      <Section title="Running low" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
