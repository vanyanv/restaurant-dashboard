"use client"

import { MList, MStrip, Section, useCounterTransition } from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { MlSections } from "@/lib/counter/adapters/monitoring-ml"

/**
 * Model health, on a phone — `P.monml.phone()`.
 *
 * A strip and the gates. The forecast-against-actual chart is desk-only: two
 * series over a month is a thing you read sitting down, and the strip already
 * carries the only number that changes a decision, which is how often the
 * model beats the baseline.
 *
 * The gates are sorted by how often they FAIL rather than by number, so a gate
 * that has never passed cannot be pushed off a three-row list by one that
 * always does.
 */
export function CounterPhoneMlClient({ sections }: { sections: SectionSources<MlSections> }) {
  const { pending } = useCounterTransition()

  return (
    <>
      <Section bare title="Model health" data={sections.headline} pending={pending}>
        {() => (
          <div>
            <h2 className="mtitle">Model health</h2>
            <p className="msub">Developer-facing · the nightly pipeline</p>
          </div>
        )}
      </Section>

      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <MStrip cells={h.phoneCells} />}
      </Section>

      <Section title="Gates" meta={(g) => g.meta} data={sections.gates} pending={pending}>
        {(g) => (
          <>
            <MList rows={g.phoneRows} />
            <p className="mono" style={{ margin: "11px 0 0" }}>
              {g.note}
            </p>
          </>
        )}
      </Section>
    </>
  )
}
