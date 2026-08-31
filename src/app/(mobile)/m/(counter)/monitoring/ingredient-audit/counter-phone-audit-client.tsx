"use client"

import { MList, MStrip, Section, useCounterTransition } from "@/components/counter"
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
      <Section bare title="Ingredient audit" data={sections.headline} pending={pending}>
        {(h) => (
          <div>
            <h2 className="mtitle">Ingredient audit</h2>
            <p className="msub">Developer-facing · what the matcher decided</p>
          </div>
        )}
      </Section>

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
            <p className="mono" style={{ margin: "11px 0 0" }}>
              {d.note}
            </p>
          </>
        )}
      </Section>
    </>
  )
}
