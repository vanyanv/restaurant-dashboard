"use client"

import { Section, useCounterTransition, usePageChrome } from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { WalkSections } from "@/lib/counter/adapters/count"
import { CountHead } from "./count-ui"
import { CountWalk } from "./count-walk"

/** Count & waste — Count, on the desk. The phone renders the same walk at /m/count. */
export function CountWalkClient({ sections }: { sections: SectionSources<WalkSections> }) {
  usePageChrome({ leaf: "Count" })
  const { pending } = useCounterTransition()
  return (
    <>
      <CountHead sub="Count what's on the shelves, the way it comes in" />
      <Section title="Weekly count" meta={(d) => d?.store.name ?? ""} data={sections.walk} pending={pending}>
        {(d) => (d ? <CountWalk key={d.store.id} data={d} base="/dashboard/count" /> : null)}
      </Section>
    </>
  )
}
