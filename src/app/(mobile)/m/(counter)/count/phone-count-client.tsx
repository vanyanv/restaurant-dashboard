"use client"

import { Section, useCounterTransition } from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { WalkSections } from "@/lib/counter/adapters/count"
import { CountHead } from "@/app/dashboard/(counter)/count/count-ui"
import { CountWalk } from "@/app/dashboard/(counter)/count/count-walk"

/** The weekly count on a phone: the same walk as the desk, with the same four tabs. */
export function PhoneCountClient({ sections }: { sections: SectionSources<WalkSections> }) {
  const { pending } = useCounterTransition()
  return (
    <>
      <CountHead sub="Count the shelves in your walk order. Each item saves as you go." />
      <Section bare title="Count" data={sections.walk} pending={pending}>
        {(d) =>
          d ? (
            <div style={{ display: "grid", gap: 12 }}>
              <CountWalk key={d.store.id} data={d} base="/m/count" />
            </div>
          ) : null
        }
      </Section>
    </>
  )
}
