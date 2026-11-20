"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/**
 * The loading boundary `npm run tokens` asks for beside every `(counter)`
 * page. This page only redirects into Inventory, so there is nothing of its
 * own to sketch.
 */
export default function Loading() {
  return (
    <Section bare title="Inventory" data={loading()}>
      {() => null}
    </Section>
  )
}
