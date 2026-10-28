"use client"

import { Section, useCounterTransition } from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { WasteSections } from "@/lib/counter/adapters/count"
import { CountHead } from "@/app/dashboard/(counter)/count/count-ui"
import { WasteLog } from "@/app/dashboard/(counter)/count/waste-log"

/** The waste log on a phone: the same form as the desk, with the same four tabs. */
export function PhoneWasteClient({ sections }: { sections: SectionSources<WasteSections> }) {
  const { pending } = useCounterTransition()
  return (
    <>
      <CountHead sub="What got thrown out, and why" />
      <Section bare title="Log waste" data={sections.waste} pending={pending}>
        {(d) =>
          d ? (
            <div style={{ display: "grid", gap: 12 }}>
              <WasteLog key={d.store.id} data={d} base="/m/count" />
            </div>
          ) : null
        }
      </Section>
    </>
  )
}
