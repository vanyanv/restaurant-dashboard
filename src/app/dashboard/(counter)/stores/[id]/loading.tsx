"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/**
 * The store file's loading boundary — the entries the client renders, in the
 * order it renders them: the strip, the four input groups, and the three
 * closed folds.
 *
 * It must track the client's composition, not a subset of it: a boundary that
 * draws fewer sections than the page resolves to is a layout that jumps once
 * the data lands, which is the shift this file exists to prevent.
 */
export default function StoreFileLoading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="Monthly costs" data={loading()}>
        {() => null}
      </Section>
      <Section title="App commissions" data={loading()}>
        {() => null}
      </Section>
      <Section title="Labor and targets" data={loading()}>
        {() => null}
      </Section>
      <Section title="Store" data={loading()}>
        {() => null}
      </Section>
      <Section title="How this is worked out" data={loading()} fold="closed">
        {() => null}
      </Section>
      <Section title="Where each input lands" data={loading()} fold="closed">
        {() => null}
      </Section>
      <Section title="Location" data={loading()} fold="closed">
        {() => null}
      </Section>
    </>
  )
}
