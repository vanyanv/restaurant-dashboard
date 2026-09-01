"use client"

import {
  CostBar,
  DeskHandoff,
  MList,
  MStrip,
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
 * **Read-only, deliberately.** The prototype's phone view ends in "Save
 * recipe" and "Add line", and a recipe is not a thing anyone edits standing
 * up — `project_mobile_direction` is a standing rule that mobile is a
 * glance-and-do tool. Editing a plate cost is neither a glance nor a do; it
 * is the one screen in this product where a mistyped quantity silently moves
 * the food-cost line on four other pages. The phone shows what the plate
 * costs and what is wrong with it, and the desk changes it.
 *
 * "The desk changes it" is a promise, so the page keeps it: the closing
 * `.mbtn` is a HANDOFF to the desk builder rather than a save button. It is
 * the same move the phone store file makes, and it is a `DeskHandoff` rather
 * than a `<Link>` because the proxy sends a phone straight back off
 * `/dashboard/**` — a plain link here would land where it started. The second
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
            <p className="mono" style={{ margin: "10px 0 0" }}>
              {c.foot}
            </p>
            {c.gap ? (
              <p className="mono" style={{ margin: "9px 0 0", color: "var(--bad)" }}>
                {c.gap.body}
              </p>
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
          product offers. See the docblock. */}
      <Section bare title="Edit" data={sections.builder} pending={pending}>
        {(b) => (
          <DeskHandoff href={`/dashboard/recipes/${b.recipeId}`}>
            Edit this recipe on the desk
          </DeskHandoff>
        )}
      </Section>
    </>
  )
}
