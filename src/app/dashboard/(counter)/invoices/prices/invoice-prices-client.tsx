"use client"

import {
  Chart,
  Note,
  Section,
  Table,
  useCounterTransition,
  usePageChrome,
  type Column,
} from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { PriceSections } from "@/lib/counter/adapters/prices"
import { InvoicesHead, Tiles } from "../invoices-ui"

/**
 * Every price that moved, ranked by what the move costs at the volume you
 * actually buy. A row opens the ingredient: every delivery, every vendor's
 * price and every recipe the move reaches.
 */
const MOVER_COLUMNS: Column[] = [
  { key: "ingredient", label: "Ingredient" },
  { key: "median", label: "Usual", numeric: true },
  { key: "latest", label: "Now", numeric: true },
  { key: "move", label: "Move", numeric: true },
  { key: "volume", label: "You buy, 30d", numeric: true },
  { key: "costs", label: "Costs you, 30d", numeric: true },
  { key: "recipes", label: "Recipes", numeric: true },
]

export function InvoicePricesClient({ sections }: { sections: SectionSources<PriceSections> }) {
  usePageChrome({
    leaf: "Prices",
    askSuggestions: ["What is costing me more this month?", "Which prices came down?"],
  })
  const { pending } = useCounterTransition()

  return (
    <>
      <InvoicesHead sub="All stores · each price against its usual, priced from every invoice line" />

      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <Tiles cells={h.cells} />}
      </Section>

      <Section
        title="Ranked by what it costs you"
        meta={(m) => `${m.allRows.length} moved · 30-day volume`}
        data={sections.movers}
        pending={pending}
        pad={false}
        askAbout="what is costing me more this month"
      >
        {(m) => (
          <>
            <Table columns={MOVER_COLUMNS} rows={m.allRows} />
            <Note flush>{m.note}</Note>
          </>
        )}
      </Section>

      <Section
        title="The three biggest moves in dollars, by week"
        meta={(c) => c.meta}
        data={sections.chart}
        pending={pending}
        askAbout="which prices moved this quarter"
      >
        {(c) => (
          <>
            <Chart {...c.chart} fmt={(v) => `${v.toFixed(0)}`} />
            <Note>{c.note}</Note>
          </>
        )}
      </Section>
    </>
  )
}
