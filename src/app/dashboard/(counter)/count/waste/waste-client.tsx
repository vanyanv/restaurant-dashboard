"use client"

import { Section, useCounterTransition, usePageChrome } from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { WasteSections } from "@/lib/counter/adapters/count"
import { CountHead } from "../count-ui"
import { WasteLog } from "../waste-log"

/** Count & waste — Waste, on the desk. The phone renders the same log at /m/count/waste. */
export function WasteClient({ sections }: { sections: SectionSources<WasteSections> }) {
  usePageChrome({ leaf: "Waste" })
  const { pending } = useCounterTransition()
  return (
    <>
      <CountHead sub="What got thrown out, and why" />
      <Section title="Log waste" meta={(d) => d?.store.name ?? ""} data={sections.waste} pending={pending}>
        {(d) => (d ? <WasteLog key={d.store.id} data={d} base="/dashboard/count" /> : null)}
      </Section>
    </>
  )
}
