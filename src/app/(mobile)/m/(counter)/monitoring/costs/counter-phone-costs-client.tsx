"use client"

import { MList, MStrip, Section, useCounterTransition } from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { CostsSections } from "@/lib/counter/adapters/monitoring-tabs"

/**
 * Costs, on a phone — `P.moncosts.phone()`.
 *
 * The spend chart is desk-only: its meaning is in the caveat under it, that a
 * short bar can be a quiet day or an unwritten cost. The strip carries the
 * count of calls that recorded $0, which is that caveat as a number.
 */
export function CounterPhoneCostsClient({
  sections,
}: {
  sections: SectionSources<CostsSections>
}) {
  const { pending } = useCounterTransition()

  return (
    <>
      <Section bare title="Costs" data={sections.headline} pending={pending}>
        {(h) => (
          <div>
            <h2 className="mtitle">Costs</h2>
            <p className="msub">{h.cells[2].value} over 30 days</p>
          </div>
        )}
      </Section>

      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <MStrip cells={h.phoneCells} />}
      </Section>

      <Section title="By feature" meta={(f) => f.meta} data={sections.features} pending={pending}>
        {(f) => (
          <>
            <MList rows={f.phoneRows} />
            <p className="mono" style={{ margin: "11px 0 0" }}>
              {f.note}
            </p>
          </>
        )}
      </Section>
    </>
  )
}
