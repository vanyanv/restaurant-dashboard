"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"
import { CountHead } from "./count-ui"

/** Inventory's loading boundary: the tabs stay put while the overview loads. */
export default function Loading() {
  return (
    <>
      <CountHead sub="Loading" />
      <Section title="Inventory" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
