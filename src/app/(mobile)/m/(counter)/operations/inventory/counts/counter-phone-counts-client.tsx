"use client"

import { MList, MStrip, Section, useCounterTransition } from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { StockCountsSections } from "@/lib/counter/adapters/stock-counts"

/**
 * Stock counts, on a phone — `P.counts.phone()`.
 *
 * The prototype ends in a primary "Resume the count" button. There is nothing
 * to resume that a phone should resume: the two open sessions have been open
 * since May, and a button that reopens a four-month-old count as if it were
 * this evening's work is the wrong offer. The list carries the sessions; the
 * variance section is desk-only, because it is an explanation rather than a
 * figure.
 */
export function CounterPhoneCountsClient({
  sections,
}: {
  sections: SectionSources<StockCountsSections>
}) {
  const { pending } = useCounterTransition()

  return (
    <>
      <Section bare title="Stock counts" data={sections.headline} pending={pending}>
        {(h) => (
          <div>
            <h2 className="mtitle">Stock counts</h2>
            <p className="msub">
              Last count {h.cells[0].value} · {h.cells[0].delta}
            </p>
          </div>
        )}
      </Section>

      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <MStrip cells={h.phoneCells} />}
      </Section>

      <Section title="Sessions" meta={(s) => s.meta} data={sections.sessions} pending={pending}>
        {(s) => (
          <>
            <MList rows={s.phoneRows} />
            <p className="mono" style={{ margin: "11px 0 0" }}>
              {s.note}
            </p>
          </>
        )}
      </Section>
    </>
  )
}
