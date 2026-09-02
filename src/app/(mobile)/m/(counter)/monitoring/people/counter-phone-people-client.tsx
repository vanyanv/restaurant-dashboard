"use client"

import { MList, MStrip, Note, Section, useCounterTransition } from "@/components/counter"
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
      {/* The page's own NAME is a constant, so it is drawn in every state.
          Inside the section it was not: a failed headline left this phone
          page with no title at all, showing "People unavailable" where
          its name belongs. Only the sub-line needs the data. Same rule the
          desk states on /dashboard/decisions — "the head is drawn in every
          state, including before that data exists". `Section bare` emits no
          DOM of its own, so the ready-state markup is unchanged. */}
      <div>
        <h2 className="mtitle">People</h2>
        <Section bare title="People" data={sections.headline} pending={pending}>
          {(h) => (
            <p className="msub">{h.cells[0].delta}</p>
          )}
        </Section>
      </div>

      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <MStrip cells={h.phoneCells} />}
      </Section>

      {/* `P.monpeople.phone()`'s "Most opened". The desk's who-answer is
          already on this surface: it is the msub and the first strip cell. */}
      <Section title="Most opened" meta={(p) => p.meta} data={sections.pages} pending={pending}>
        {(p) => (
          <>
            <MList rows={p.phoneRows} />
            <Note>
              {p.note}
            </Note>
          </>
        )}
      </Section>
    </>
  )
}
