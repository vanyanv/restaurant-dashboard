"use client"

import { Section } from "@/components/counter"
import { loading } from "@/lib/counter/section-data"

/**
 * The Menu hub's content-only loading boundary.
 *
 * Built from `Section` with `loading()` rather than a second skeleton, so
 * there is one loading appearance in the product. Order and titles mirror
 * `counter-menu-client.tsx`: the bare strip, then the `.split` pair.
 */
export default function MenuLoading() {
  return (
    <>
      <Section bare title="The figures" data={loading()}>
        {() => null}
      </Section>
      <div className="split">
        <Section title="Where to work" data={loading()}>
          {() => null}
        </Section>
        <Section title="By category" data={loading()}>
          {() => null}
        </Section>
      </div>
    </>
  )
}
