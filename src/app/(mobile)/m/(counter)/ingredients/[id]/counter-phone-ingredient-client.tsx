"use client"

import { Chart, MList, MStrip, Note, Section, useCounterTransition } from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { IngredientSections } from "@/lib/counter/adapters/ingredient"

/**
 * One ingredient, on a phone — `P.ingredient.phone()`
 * (`docs/counter/counter-prototype.html:7051`): the title, a two-cell strip,
 * the price history and what uses it — plus the deliveries list argued below,
 * which the prototype does not draw.
 *
 * The prototype's second phone cell is `On hand · 36 lb · below par`. It is
 * kept — as the strip's own cell — because the absence is the point: an
 * ingredient nobody has ever counted is worth saying on the surface a person
 * reads while standing in the walk-in.
 *
 * "Deliveries" is OURS, not the prototype's, and it is on the phone for that
 * same reason: the person in the walk-in asking whether they are about to run
 * out is asking when the last one arrived, and the phone is where they are
 * standing when they ask. The desk lists up to eight arrivals and the phone
 * up to three — `PHONE_ROWS` in the adapter, the same cut "Used in" takes
 * below it.
 * The note under the list is rendered here as well as on the desk because it
 * is where the adapter says what the converted quantities LEAVE OUT, and a
 * quantity without that caveat is an under-count that looks exact.
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

      <Section
        title="Deliveries"
        meta={(x) => x.meta}
        data={sections.deliveries}
        pending={pending}
      >
        {(x) => (
          <>
            {x.phoneRows.length === 0 ? null : <MList rows={x.phoneRows} />}
            <Note bare={x.phoneRows.length === 0}>
              {x.note}
            </Note>
          </>
        )}
      </Section>

      <Section title="Used in" meta={(u) => u.meta} data={sections.usedIn} pending={pending}>
        {(u) =>
          u.phoneRows.length === 0 ? (
            <Note bare>
              {u.note}
            </Note>
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
