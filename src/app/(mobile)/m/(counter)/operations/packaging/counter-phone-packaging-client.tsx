"use client"

import { MList, MStrip, Section, useCounterTransition } from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { PackagingSections } from "@/lib/counter/adapters/packaging"

/**
 * Packaging, on a phone — `P.packaging.phone()`: the title, a two-cell strip
 * and the containers.
 *
 * The phone's strip carries the per-order cost and whether the invoices agree,
 * rather than the prototype's spend and share of COGS. Spend is a number to
 * read at a desk; whether the model can be trusted is what decides if the
 * number below it means anything.
 */
export function CounterPhonePackagingClient({
  sections,
}: {
  sections: SectionSources<PackagingSections>
}) {
  const { pending } = useCounterTransition()

  return (
    <>
      <Section bare title="Packaging" data={sections.headline} pending={pending}>
        {(h) => (
          <div>
            <h2 className="mtitle">Packaging</h2>
            <p className="msub">
              {h.cells[1].value} an order · {h.cells[0].value} in all
            </p>
          </div>
        )}
      </Section>

      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <MStrip cells={h.phoneCells} />}
      </Section>

      <Section title="Containers" meta={(l) => l.meta} data={sections.ledger} pending={pending}>
        {(l) => (
          <>
            <MList rows={l.phoneRows} />
            <p className="mono" style={{ margin: "11px 0 0" }}>
              {l.note}
            </p>
          </>
        )}
      </Section>
    </>
  )
}
