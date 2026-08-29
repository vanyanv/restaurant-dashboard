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
} from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { PriceSections } from "@/lib/counter/adapters/prices"

/**
 * Price monitor — `P.prices`.
 *
 * The prototype's table header is the whole design and is kept verbatim:
 * *"Ranked by what it costs you, not by percentage."* See the adapter for why
 * the move is measured against a trailing median rather than the previous
 * month, and for the ingredient whose 1,005% rise is a pack read wrong.
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

const HELD_COLUMNS: Column[] = [
  { key: "ingredient", label: "Ingredient" },
  { key: "median", label: "Was", numeric: true },
  { key: "latest", label: "Read as", numeric: true },
  { key: "move", label: "Move", numeric: true },
  { key: "deliveries", label: "Deliveries", numeric: true },
  { key: "why", label: "Why held" },
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

      <Section bare title="Verdict" data={sections.headline} pending={pending}>
        {(h) => (
          <div className="sec">
            <div className="sec__body">
              <p className="verdictline" style={{ margin: 0 }}>
                {h.verdict}
              </p>
            </div>
          </div>
        )}
      </Section>

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

      <Section
        title="Held out"
        meta={(h) => h.meta}
        data={sections.held}
        pending={pending}
        pad={false}
        askAbout="which price moves were rejected as parsing errors"
      >
        {(h) => (
          <>
            <Table columns={HELD_COLUMNS} rows={h.rows} />
            <p className="mono" style={{ margin: 0, padding: "13px 15px" }}>
              {h.note}
            </p>
          </>
        )}
      </Section>
    </>
  )
}
