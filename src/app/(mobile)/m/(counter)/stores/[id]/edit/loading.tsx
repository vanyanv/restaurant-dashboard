"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/**
 * The store file's loading boundary — the eight entries the client renders, in
 * the order it renders them.
 *
 * It must track the client's composition, not a subset of it: a boundary that
 * draws five sections for a page that resolves to eight is a layout that jumps
 * once the data lands, which is the shift this file exists to prevent.
 */
export default function StoreFileLoading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <Section title="Operating inputs" data={loading()}>
        {() => null}
      </Section>
      <div className="split">
        <Section title="How it reaches the P&L" data={loading()}>
          {() => null}
        </Section>
        <Section title="Location file" data={loading()}>
          {() => null}
        </Section>
      </div>
      <Section title="Fixed expenses" data={loading()}>
        {() => null}
      </Section>
      <div className="tri">
        <Section title="Platform commissions" data={loading()}>
          {() => null}
        </Section>
        <Section title="Targets" data={loading()}>
          {() => null}
        </Section>
        <Section title="Where it lands" data={loading()}>
          {() => null}
        </Section>
      </div>
      <Section title="Edit this file" data={loading()}>
        {() => null}
      </Section>
    </>
  )
}
