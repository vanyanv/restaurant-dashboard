"use client"

import Link from "next/link"
import {
  CostBar,
  MList,
  MStrip,
  Note,
  Section,
  useCounterTransition,
} from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { RecipeSections } from "@/lib/counter/adapters/recipe"

/**
 * One recipe, on a phone — `P.recipe.phone()`
 * (`docs/counter/counter-prototype.html:6243`): the title, a two-cell strip,
 * the cost bar with its legend, and the lines.
 *
 * **The view is read-only; editing is one tap away.** This page shows what
 * the plate costs and what is wrong with it. Its closing `.mbtn` opens the
 * desk builder inside the phone shell, at `/m/recipes/[id]/edit` (the owner
 * asked, 2026-10-28, for everything on the desk to work on the phone). It
 * used to be a desk hand-off that set `prefer-desktop` for a week, which is
 * what took the bottom bar away from every page after it. The second
 * of the design's two buttons, "Add line", is declared in the manifest.
 */
export function CounterPhoneRecipeClient({
  sections,
}: {
  sections: SectionSources<RecipeSections>
}) {
  const { pending } = useCounterTransition()

  return (
    <>
      <Section bare title="Recipe" data={sections.head} pending={pending}>
        {(h) => (
          <div>
            <h2 className="mtitle">{h.title}</h2>
            <p className="msub">{h.sub}</p>
          </div>
        )}
      </Section>

      <Section bare title="The figures" data={sections.head} pending={pending}>
        {(h) => <MStrip cells={h.phoneCells} />}
      </Section>

      <Section title="What it costs" meta={() => "live"} data={sections.cost} pending={pending}>
        {(c) => (
          <>
            {/* CostBar draws its own legend — see the desk client. */}
            <CostBar bands={c.bands} />
            <Note>
              {c.foot}
            </Note>
            {c.gap ? (
              <Note tone="bad">
                {c.gap.body}
              </Note>
            ) : null}
          </>
        )}
      </Section>

      <Section title="The recipe" meta={(b) => b.meta} data={sections.builder} pending={pending}>
        {(b) => (
          <MList
            rows={b.lines.map((l) => ({
              key: l.key,
              title: l.name,
              detail: `${l.quantity} ${l.unit}`,
              value: l.ext,
              note: l.missing ? "no cost" : undefined,
              noteTone: l.missing ? "down" : undefined,
            }))}
          />
        )}
      </Section>

      {/* `P.recipe.phone()` closes on two buttons; this is the one this
          product offers. It opens the desk editor inside the phone shell,
          at `/m/recipes/[id]/edit`, so the phone stays a phone. */}
      <Section bare title="Edit" data={sections.builder} pending={pending}>
        {(b) => (
          <Link className="mbtn mbtn--primary" href={`/m/recipes/${b.recipeId}/edit`}>
            Edit this recipe
          </Link>
        )}
      </Section>
    </>
  )
}
