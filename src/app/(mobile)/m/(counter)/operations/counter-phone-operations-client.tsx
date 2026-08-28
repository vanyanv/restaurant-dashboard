"use client"

import { MList, MStrip, Section, useCounterTransition } from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { OperationsSections } from "@/lib/counter/adapters/operations"

/**
 * Operations, on a phone — `P.operations.phone()`: the title, a two-cell strip
 * and the areas.
 *
 * The prototype's phone view is the areas list alone. The strip is kept
 * because the two cells that survive — how much is open, and how many areas
 * are still being touched — are what decide whether the list below is a
 * to-do or an archive.
 */
export function CounterPhoneOperationsClient({
  sections,
}: {
  sections: SectionSources<OperationsSections>
}) {
  const { pending } = useCounterTransition()

  return (
    <>
      <Section bare title="Operations" data={sections.headline} pending={pending}>
        {(h) => (
          <div>
            <h2 className="mtitle">Operations</h2>
            <p className="msub">
              {h.cells[0].value} open · {h.cells[1].value} areas moving
            </p>
          </div>
        )}
      </Section>

      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <MStrip cells={h.phoneCells} />}
      </Section>

      <Section title="Areas" meta={(a) => a.meta} data={sections.areas} pending={pending}>
        {(a) => <MList rows={a.phoneRows} />}
      </Section>
    </>
  )
}
