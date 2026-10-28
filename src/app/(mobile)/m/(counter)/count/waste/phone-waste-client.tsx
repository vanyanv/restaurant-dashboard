"use client"

import { Section, useCounterTransition } from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { WasteSections } from "@/lib/counter/adapters/count"
import { WasteLog } from "@/app/dashboard/(counter)/count/waste-log"

/** The waste log on a phone: the same form as the desk, without the tabs. */
export function PhoneWasteClient({ sections }: { sections: SectionSources<WasteSections> }) {
  const { pending } = useCounterTransition()
  return (
    <Section bare title="Log waste" data={sections.waste} pending={pending}>
      {(d) =>
        d ? (
          <div style={{ display: "grid", gap: 12 }}>
            <h2 className="mtitle">Log waste</h2>
            <WasteLog key={d.store.id} data={d} base="/m/count" />
          </div>
        ) : null
      }
    </Section>
  )
}
