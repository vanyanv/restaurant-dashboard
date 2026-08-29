"use client"

import { MList, MStrip, Section, useCounterTransition } from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { StoresSections } from "@/lib/counter/adapters/stores"

/** Stores, on a phone — `P.stores.phone()`: the title, a two-cell strip, the locations. */
export function CounterPhoneStoresClient({
  sections,
}: {
  sections: SectionSources<StoresSections>
}) {
  const { pending } = useCounterTransition()

  return (
    <>
      <Section bare title="Stores" data={sections.headline} pending={pending}>
        {(h) => (
          <div>
            <h2 className="mtitle">Stores</h2>
            <p className="msub">
              {h.cells[0].value} locations · {h.cells[0].delta}
            </p>
          </div>
        )}
      </Section>

      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <MStrip cells={h.phoneCells} />}
      </Section>

      <Section title="Locations" meta={(t) => t.meta} data={sections.table} pending={pending}>
        {(t) => <MList rows={t.phoneRows} />}
      </Section>
    </>
  )
}
