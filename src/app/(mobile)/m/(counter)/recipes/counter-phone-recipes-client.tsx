"use client"

import Link from "next/link"
import { MList, MStrip, Section, useCounterTransition } from "@/components/counter"
import type { RecipesSections } from "@/lib/counter/adapters/recipes"
import type { SectionSources } from "@/lib/counter/adapters/types"

/**
 * Recipes, on a phone — `P.recipes.phone()`
 * (`docs/counter/counter-prototype.html:6136`): the title, a two-cell strip, a
 * list, and one button.
 *
 * The prototype's list is headed "Recent" and its button reads "Confirm 9
 * recipes". Neither survives contact with this account. Nothing has been
 * created in four months, so "recent" would be a list of things from April;
 * and the nine are AI-generated recipes that do not exist here. The list is
 * ordered worst-first instead — plates with no lines, then by what they sold —
 * and the button goes to the plate that costs nothing, because a phone gets
 * one button and that is the one thing on this page nobody is looking for.
 */
export function CounterPhoneRecipesClient({
  sections,
}: {
  sections: SectionSources<RecipesSections>
}) {
  const { pending } = useCounterTransition()

  return (
    <>
      <Section bare title="Recipes" data={sections.headline} pending={pending}>
        {(h) => (
          <div>
            <h2 className="mtitle">Recipes</h2>
            <p className="msub">
              {h.cells[0].value} · {h.cells[1].value} confirmed
            </p>
          </div>
        )}
      </Section>

      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <MStrip cells={h.phoneCells} />}
      </Section>

      <Section title="Worst first" meta={(r) => r.meta} data={sections.recent} pending={pending}>
        {(r) => <MList rows={r.rows} />}
      </Section>

      <Section bare title="Go" data={sections.work} pending={pending}>
        {(w) => (
          <Link className="mbtn mbtn--primary" href={w.items[0]?.href ?? "/dashboard/recipes"}>
            {w.items[0] ? w.items[0].title : "The catalogue"}
          </Link>
        )}
      </Section>
    </>
  )
}
