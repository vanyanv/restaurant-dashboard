"use client"

import {
  Chart,
  PageHead,
  Section,
  Strip,
  Table,
  useCounterTransition,
  usePageChrome,
  type Column,
  SubNav,
} from "@/components/counter"
import { INGREDIENT_TABS } from "@/lib/counter/nav"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { PriceSections } from "@/lib/counter/adapters/prices"

/**
 * Price monitor — `P.prices`.
 *
 * The prototype's table header is the whole design and is kept verbatim:
 * *"Ranked by what it costs you, not by percentage."* See the adapter for why
 * the move is measured against a trailing median rather than the previous
 * month, and for the ingredient whose 1,005% rise is a pack read wrong.
 *
 * Composed as `P.prices.desk()` composes it: strip -> "What moved" -> one
 * table. There was a verdict block above the strip, which this design has
 * none of, and a second "Held out" table, which had one row on this account
 * and whose whole content was the REASON that row was held out. Both are
 * prose now — the held-out sentence is the last thing the table's own note
 * says, where a reader is already asking what is not in it.
 */
const MOVER_COLUMNS: Column[] = [
  { key: "ingredient", label: "Ingredient" },
  { key: "median", label: "Was", numeric: true },
  { key: "latest", label: "Now", numeric: true },
  { key: "move", label: "Move", numeric: true },
  { key: "volume", label: "Volume, 30d", numeric: true },
  { key: "costs", label: "Costs you", numeric: true },
  { key: "recipes", label: "Recipes", numeric: true },
]

export function CounterPricesClient({ sections }: { sections: SectionSources<PriceSections> }) {
  usePageChrome({
    leaf: "Price monitor",
    askSuggestions: ["What is costing me more this month?", "Which prices came down?"],
  })
  const { pending } = useCounterTransition()

  return (
    <>
      <PageHead
        title="Price monitor"
        sub="Every price that moved, ranked by what the move costs you"
      />

      {/* The design's `VIEWS` bar for this family — see `INGREDIENT_TABS` in
          `@/lib/counter/nav`. Without it these siblings are pages nothing
          links to; `.seg` is not a fidelity landmark, so it changes no count. */}
      <SubNav items={INGREDIENT_TABS} label="Ingredients" />

      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <Strip cells={h.cells} />}
      </Section>

      <Section
        title="What moved"
        meta={(c) => c.meta}
        data={sections.chart}
        pending={pending}
        askAbout="which prices moved this quarter"
      >
        {(c) => (
          <>
            <Chart {...c.chart} fmt={(v) => `${v.toFixed(0)}`} />
            <p className="mono" style={{ marginBottom: 0 }}>
              {c.note}
            </p>
          </>
        )}
      </Section>

      <Section
        title="Ranked by what it costs you"
        meta={(m) => m.meta}
        data={sections.movers}
        pending={pending}
        pad={false}
        askAbout="what is costing me more this month"
      >
        {(m) => (
          <>
            <Table columns={MOVER_COLUMNS} rows={m.rows} />
            {/* No `.sec__body` — a table section emits the table alone. */}
            <p className="mono" style={{ margin: 0, padding: "13px 15px" }}>
              {m.note}
            </p>
          </>
        )}
      </Section>
    </>
  )
}
