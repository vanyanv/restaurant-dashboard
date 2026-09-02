"use client"

import { MList, MStrip, Note, Section, SubNav, useCounterTransition } from "@/components/counter"
import { PHONE_INGREDIENT_TABS } from "@/lib/counter/nav"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { PriceSections } from "@/lib/counter/adapters/prices"

/**
 * The price monitor, on a phone — `P.prices.phone()`.
 *
 * A strip and one list, ranked by money rather than by percentage, which is
 * the page's whole argument and survives being cut down. The "What moved"
 * chart is desk-only: three overlaid price series in a phone's width is a
 * picture rather than a reading, and the list already carries each
 * ingredient's was-and-now.
 */
export function CounterPhonePricesClient({
  sections,
}: {
  sections: SectionSources<PriceSections>
}) {
  const { pending } = useCounterTransition()

  return (
    <>
      {/* The design's `VIEWS` bar, first inside `.mscroll` — which is exactly
          where `phoneFor()` puts a `.seg`. Same destinations as the desk's,
          on `/m` paths. */}
      <SubNav items={PHONE_INGREDIENT_TABS} label="Ingredients" />

      {/* The page's own NAME is a constant, so it is drawn in every state.
          Inside the section it was not: a failed headline left this phone
          page with no title at all, showing "Price monitor unavailable" where
          its name belongs. Only the sub-line needs the data. Same rule the
          desk states on /dashboard/decisions — "the head is drawn in every
          state, including before that data exists". `Section bare` emits no
          DOM of its own, so the ready-state markup is unchanged. */}
      <div>
        <h2 className="mtitle">Price monitor</h2>
        <Section bare title="Price monitor" data={sections.headline} pending={pending}>
          {(h) => (
            <p className="msub">
              {h.cells[0].label} {h.cells[0].value}
            </p>
          )}
        </Section>
      </div>

      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <MStrip cells={h.phoneCells} />}
      </Section>

      <Section
        title="Ranked by cost"
        meta={(m) => m.meta}
        data={sections.movers}
        pending={pending}
      >
        {(m) => (
          <>
            <MList rows={m.phoneRows} />
            <Note>
              {m.note}
            </Note>
          </>
        )}
      </Section>
    </>
  )
}
