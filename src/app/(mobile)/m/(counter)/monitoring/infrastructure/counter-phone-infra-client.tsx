"use client"

import { MList, MStrip, Note, Section, useCounterTransition } from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { InfraSections } from "@/lib/counter/adapters/monitoring-infra"

/**
 * Infrastructure, on a phone — `P.moninfra.phone()`.
 *
 * Two lists and a strip, which is the whole page: whether anything that runs
 * on its own is broken, and what the database is made of. The desk's table of
 * ten tables becomes three, and its six-column job table becomes a line each,
 * failures first — a phone is where you find out something is wrong, not
 * where you read the column that says how long the mean run took.
 *
 * `P.moninfra.phone()`'s first list is Tokens. Ours is the jobs, the same
 * substitution the desk makes and for the same reason: no credential expiry is
 * recorded anywhere. See the desk client.
 *
 * The closing paragraph the desk carries is desk-only. It is an argument about
 * what cannot be measured, and the standing rule for this surface is that the
 * phone is a lean glance-and-do tool.
 */
export function CounterPhoneInfraClient({
  sections,
}: {
  sections: SectionSources<InfraSections>
}) {
  const { pending } = useCounterTransition()

  return (
    <>
      {/* The page's own NAME is a constant, so it is drawn in every state.
          Inside the section it was not: a failed headline left this phone
          page with no title at all, showing "Infrastructure unavailable" where
          its name belongs. Only the sub-line needs the data. Same rule the
          desk states on /dashboard/decisions — "the head is drawn in every
          state, including before that data exists". `Section bare` emits no
          DOM of its own, so the ready-state markup is unchanged. */}
      <div>
        <h2 className="mtitle">Infrastructure</h2>
        <Section bare title="Infrastructure" data={sections.headline} pending={pending}>
          {(h) => (
            <p className="msub">{h.cells[0].value} of database</p>
          )}
        </Section>
      </div>

      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <MStrip cells={h.phoneCells} />}
      </Section>

      <Section title="Scheduled jobs" meta={(j) => j.meta} data={sections.jobs} pending={pending}>
        {(j) => (
          <>
            <MList rows={j.phoneRows} />
            <Note>
              {j.note}
            </Note>
          </>
        )}
      </Section>

      <Section
        title="Largest tables"
        meta={(s) => s.meta}
        data={sections.storage}
        pending={pending}
      >
        {(s) => (
          <>
            <MList rows={s.phoneRows} />
            <Note>
              {s.note}
            </Note>
          </>
        )}
      </Section>
    </>
  )
}
