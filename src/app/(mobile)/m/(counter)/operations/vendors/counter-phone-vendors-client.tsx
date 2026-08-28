"use client"

import { Chart, MList, MStrip, Section, useCounterTransition } from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { VendorsSections } from "@/lib/counter/adapters/vendors"

/**
 * Vendors, on a phone — `P.vendors.phone()`: the title, a two-cell strip, the
 * trend and a list by spend.
 *
 * The prototype's second phone cell is `On time · 92%`. Nothing in this schema
 * records a promised delivery date, so it is replaced by the reconciliation
 * count — which is the other thing a phone reader can act on and the one this
 * account actually has an answer for.
 */
export function CounterPhoneVendorsClient({
  sections,
}: {
  sections: SectionSources<VendorsSections>
}) {
  const { pending } = useCounterTransition()

  return (
    <>
      <Section bare title="Vendors" data={sections.headline} pending={pending}>
        {(h) => (
          <div>
            <h2 className="mtitle">Vendors</h2>
            <p className="msub">
              {h.cells[0].value} · {h.cells[0].delta}
            </p>
          </div>
        )}
      </Section>

      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <MStrip cells={h.phoneCells} />}
      </Section>

      <Section title="Price trend" meta={(t) => t.meta} data={sections.trend} pending={pending}>
        {(t) => <Chart {...t.phoneChart} fmt={INDEX} />}
      </Section>

      <Section title="By spend" meta={(l) => l.meta} data={sections.list} pending={pending}>
        {(l) => <MList rows={l.rows} />}
      </Section>
    </>
  )
}

/** Matches the desk client — see its comment. */
const INDEX = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`
