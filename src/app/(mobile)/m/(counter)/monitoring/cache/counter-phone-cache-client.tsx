"use client"

import { MList, MStrip, Note, Section, useCounterTransition } from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { CacheSections } from "@/lib/counter/adapters/monitoring-tabs"

/** Cache, on a phone — `P.moncache.phone()`. */
export function CounterPhoneCacheClient({
  sections,
}: {
  sections: SectionSources<CacheSections>
}) {
  const { pending } = useCounterTransition()

  return (
    <>
      {/* The page's own NAME is a constant, so it is drawn in every state.
          Inside the section it was not: a failed headline left this phone
          page with no title at all, showing "Cache unavailable" where
          its name belongs. Only the sub-line needs the data. Same rule the
          desk states on /dashboard/decisions — "the head is drawn in every
          state, including before that data exists". `Section bare` emits no
          DOM of its own, so the ready-state markup is unchanged. */}
      <div>
        <h2 className="mtitle">Cache</h2>
        <Section bare title="Cache" data={sections.headline} pending={pending}>
          {(h) => (
            <p className="msub">{h.cells[0].value} blended · 168 hours</p>
          )}
        </Section>
      </div>

      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <MStrip cells={h.phoneCells} />}
      </Section>

      <Section title="By prefix" meta={(p) => p.meta} data={sections.prefixes} pending={pending}>
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
