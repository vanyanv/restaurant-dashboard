"use client"

import { Chart, MList, MStrip, Section, useCounterTransition } from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { IngredientSections } from "@/lib/counter/adapters/ingredient"

/**
 * One ingredient, on a phone — `P.ingredient.phone()`
 * (`docs/counter/counter-prototype.html:7051`): the title, a two-cell strip,
 * the price history and what uses it.
 *
 * The prototype's second phone cell is `On hand · 36 lb · below par`. It is
 * kept — as the strip's own cell — because the absence is the point: an
 * ingredient nobody has ever counted is worth saying on the surface a person
 * reads while standing in the walk-in.
 */
export function CounterPhoneIngredientClient({
  sections,
}: {
  sections: SectionSources<IngredientSections>
}) {
  const { pending } = useCounterTransition()

  return (
    <>
      <Section bare title="Ingredient" data={sections.head} pending={pending}>
        {(h) => (
          <div>
            <h2 className="mtitle">{h.title}</h2>
            <p className="msub">
              {h.cells[0].value} · {h.cells[0].delta}
            </p>
          </div>
        )}
      </Section>

      <Section bare title="The figures" data={sections.head} pending={pending}>
        {(h) => <MStrip cells={h.phoneCells} />}
      </Section>

      <Section
        title="Price history"
        meta={(p) => p.meta}
        data={sections.prices}
        pending={pending}
      >
        {(p) => <Chart {...p.phoneChart} fmt={PRICE} />}
      </Section>

      <Section title="Used in" meta={(u) => u.meta} data={sections.usedIn} pending={pending}>
        {(u) =>
          u.phoneRows.length === 0 ? (
            <p className="mono" style={{ margin: 0 }}>
              {u.note}
            </p>
          ) : (
            <MList rows={u.phoneRows} />
          )
        }
      </Section>
    </>
  )
}

/** Matches the desk client. */
const PRICE = (v: number) => `$${v.toFixed(2)}`
