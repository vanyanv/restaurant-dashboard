"use client"

import Link from "next/link"
import { Chart, MList, MStrip, Section, useCounterTransition } from "@/components/counter"
import type { IngredientsSections } from "@/lib/counter/adapters/ingredients"
import type { SectionSources } from "@/lib/counter/adapters/types"

/**
 * Ingredients, on a phone — `P.ingredients.phone()`
 * (`docs/counter/counter-prototype.html:5828`): the title, a two-cell strip,
 * the price monitor, what moved most, and one button.
 *
 * The prototype's button reads "Match 4 unmatched lines". Here it goes to the
 * bigger of the two gaps — the ingredients that are bought and appear in no
 * recipe — because that is 43 items and $36,589 against 24 lines and $846, and
 * a phone gets one button.
 */
export function CounterPhoneIngredientsClient({
  sections,
}: {
  sections: SectionSources<IngredientsSections>
}) {
  const { pending } = useCounterTransition()

  return (
    <>
      <Section bare title="Ingredients" data={sections.headline} pending={pending}>
        {(h) => (
          <div>
            <h2 className="mtitle">Ingredients</h2>
            <p className="msub">
              {h.cells[0].value} items · {h.cells[2].value} in no recipe
            </p>
          </div>
        )}
      </Section>

      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <MStrip cells={h.phoneCells} />}
      </Section>

      <Section
        title="Price monitor"
        meta={() => "drag to read"}
        data={sections.prices}
        pending={pending}
      >
        {(p) => <Chart {...p.phoneChart} fmt={PRICE} />}
      </Section>

      <Section title="Moving most" meta={(m) => m.meta} data={sections.moving} pending={pending}>
        {(m) => <MList rows={m.rows} />}
      </Section>

      <Section bare title="Go" data={sections.work} pending={pending}>
        {(w) => (
          <Link className="mbtn mbtn--primary" href={w.items[0]?.href ?? "/dashboard/ingredients"}>
            {w.items[0] ? `${w.items[0].lead} bought into no recipe` : "The catalogue"}
          </Link>
        )}
      </Section>
    </>
  )
}

/** Percent change, matching the desk client — see its comment. */
const PRICE = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`
