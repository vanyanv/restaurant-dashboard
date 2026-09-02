"use client"

import { MList, MStrip, Note, Section, useCounterTransition } from "@/components/counter"
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
      {/* The page's own NAME is a constant, so it is drawn in every state.
          Inside the section it was not: a failed headline left this phone
          page with no title at all, showing "Costs unavailable" where
          its name belongs. Only the sub-line needs the data. Same rule the
          desk states on /dashboard/decisions — "the head is drawn in every
          state, including before that data exists". `Section bare` emits no
          DOM of its own, so the ready-state markup is unchanged. */}
      <div>
        <h2 className="mtitle">Costs</h2>
        <Section bare title="Costs" data={sections.headline} pending={pending}>
          {(h) => (
            <p className="msub">{h.cells[2].value} over 30 days</p>
          )}
        </Section>
      </div>

      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <MStrip cells={h.phoneCells} />}
      </Section>

      <Section title="By feature" meta={(f) => f.meta} data={sections.features} pending={pending}>
        {(f) => (
          <>
            <MList rows={f.phoneRows} />
            <Note>
              {f.note}
            </Note>
          </>
        )}
      </Section>
    </>
  )
}
