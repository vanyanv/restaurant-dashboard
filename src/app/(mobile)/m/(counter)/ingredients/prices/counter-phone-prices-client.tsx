"use client"

import { MList, MStrip, Section, useCounterTransition } from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { PriceSections } from "@/lib/counter/adapters/prices"

/**
 * The price monitor, on a phone — `P.prices.phone()`.
 *
 * A strip and one list, ranked by money rather than by percentage, which is
 * the page's whole argument and survives being cut down. The "What moved"
 * chart is desk-only: three overlaid price series in a phone's width is a
 * picture rather than a reading, and the list already carries each
 * ingredient's was-and-now.
 */
export function CounterPhonePricesClient({
  sections,
}: {
  sections: SectionSources<PriceSections>
}) {
  const { pending } = useCounterTransition()

  return (
    <>
      <Section bare title="Price monitor" data={sections.headline} pending={pending}>
        {(h) => (
          <div>
            <h2 className="mtitle">Price monitor</h2>
            <p className="msub">
              {h.cells[0].label} {h.cells[0].value}
            </p>
          </div>
        )}
      </Section>

      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <MStrip cells={h.phoneCells} />}
      </Section>

      <Section
        title="Ranked by cost"
        meta={(m) => m.meta}
        data={sections.movers}
        pending={pending}
      >
        {(m) => (
          <>
            <MList rows={m.phoneRows} />
            <p className="mono" style={{ margin: "11px 0 0" }}>
              {m.note}
            </p>
          </>
        )}
      </Section>
    </>
  )
}
