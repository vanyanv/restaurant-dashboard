"use client"

import { MList, MStrip, Section, useCounterTransition } from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { PeopleSections } from "@/lib/counter/adapters/monitoring-people"

/** People, on a phone — `P.monpeople.phone()`. */
export function CounterPhonePeopleClient({
  sections,
}: {
  sections: SectionSources<PeopleSections>
}) {
  const { pending } = useCounterTransition()

  return (
    <>
      <Section bare title="People" data={sections.headline} pending={pending}>
        {(h) => (
          <div>
            <h2 className="mtitle">People</h2>
            <p className="msub">{h.cells[0].delta}</p>
          </div>
        )}
      </Section>

      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <MStrip cells={h.phoneCells} />}
      </Section>

      <Section title="Who opens it" meta={(w) => w.meta} data={sections.who} pending={pending}>
        {(w) => (
          <>
            <MList rows={w.phoneRows} />
            <p className="mono" style={{ margin: "11px 0 0" }}>
              {w.note}
            </p>
          </>
        )}
      </Section>
    </>
  )
}
