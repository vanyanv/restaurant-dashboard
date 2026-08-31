"use client"

import { MList, Section, useCounterTransition } from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { OperationsSections } from "@/lib/counter/adapters/operations"

/**
 * Operations, on a phone — `P.operations.phone()`: the title and the areas.
 *
 * NO STRIP, and it used to have one. The note here argued for keeping it
 * because "how much is open, and how many areas are still being touched" is
 * what decides whether the list below is a to-do or an archive — which is
 * true, and is already what the `.msub` one line down says, from the same two
 * cells. The strip was printing the subtitle again in bigger type.
 *
 * The prototype's phone view is the areas list alone and its own subtitle
 * carries the same fact ("7 open across four areas"), so this is the design
 * agreeing rather than the design being followed at a cost.
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


      <Section title="Areas" meta={(a) => a.meta} data={sections.areas} pending={pending}>
        {(a) => <MList rows={a.phoneRows} />}
      </Section>
    </>
  )
}
