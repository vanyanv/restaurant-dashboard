"use client"

import { MList, MStrip, Note, Section, useCounterTransition } from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { AuditSections } from "@/lib/counter/adapters/monitoring-ingredients"

/**
 * The ingredient audit, on a phone — `P.moningredients.phone()`.
 *
 * A strip and one list of recent decisions. The audit table is desk-only:
 * six columns of catalogue state is a thing you sit down with, and the one
 * question worth asking on a phone is what the matcher decided lately and
 * whether it stuck.
 *
 * The closing paragraph is desk-only for the same reason it is a paragraph —
 * it is an argument about what cannot be computed, not a figure.
 */
export function CounterPhoneAuditClient({
  sections,
}: {
  sections: SectionSources<AuditSections>
}) {
  const { pending } = useCounterTransition()

  return (
    <>
      {/* The page's own NAME is a constant, so it is drawn in every state.
          Inside the section it was not: a failed headline left this phone
          page with no title at all, showing "Ingredient audit unavailable" where
          its name belongs. Only the sub-line needs the data. Same rule the
          desk states on /dashboard/decisions — "the head is drawn in every
          state, including before that data exists". `Section bare` emits no
          DOM of its own, so the ready-state markup is unchanged. */}
      <div>
        <h2 className="mtitle">Ingredient audit</h2>
        <Section bare title="Ingredient audit" data={sections.headline} pending={pending}>
          {(h) => (
            <p className="msub">Developer-facing · what the matcher decided</p>
          )}
        </Section>
      </div>

      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <MStrip cells={h.phoneCells} />}
      </Section>

      <Section
        title="Recent decisions"
        meta={(d) => d.meta}
        data={sections.decisions}
        pending={pending}
      >
        {(d) => (
          <>
            <MList rows={d.phoneRows} />
            <Note>
              {d.note}
            </Note>
          </>
        )}
      </Section>
    </>
  )
}
