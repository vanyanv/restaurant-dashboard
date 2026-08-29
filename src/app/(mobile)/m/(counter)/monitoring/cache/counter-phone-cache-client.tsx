"use client"

import { MList, MStrip, Section, useCounterTransition } from "@/components/counter"
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
      <Section bare title="Cache" data={sections.headline} pending={pending}>
        {(h) => (
          <div>
            <h2 className="mtitle">Cache</h2>
            <p className="msub">{h.cells[0].value} blended · 168 hours</p>
          </div>
        )}
      </Section>

      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <MStrip cells={h.phoneCells} />}
      </Section>

      <Section title="By prefix" meta={(p) => p.meta} data={sections.prefixes} pending={pending}>
        {(p) => (
          <>
            <MList rows={p.phoneRows} />
            <p className="mono" style={{ margin: "11px 0 0" }}>
              {p.note}
            </p>
          </>
        )}
      </Section>
    </>
  )
}
