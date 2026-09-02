"use client"

import {
  Chart,
  Note,
  PageHead,
  Queue,
  Section,
  Strip,
  SubNav,
  Table,
  useCounterTransition,
  usePageChrome,
  type Column,
} from "@/components/counter"
import { MONITORING_TABS } from "@/lib/counter/nav"
import { money } from "@/lib/counter/format"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { MlSections } from "@/lib/counter/adapters/monitoring-ml"

/**
 * Model health — `P.monml`.
 *
 * Composed as `P.monml.desk()` composes it: strip -> "Forecast against
 * actual" -> "Gates" -> "Known gaps". One table and one queue, not four
 * tables and a verdict block.
 *
 * The prototype's strip leads with "MAPE 8.4%" and "Beat the naive guess, 21
 * of 30". Both are inventions, and the second is backwards: the revenue model
 * has beaten the seasonal-naive baseline 0 times in 232 evaluations. That fact
 * used to open the page as a verdict paragraph and now leads the queue, which
 * is where a design puts a known problem with a size on it — and it is a
 * better home for it, because a queue item can say how big it is.
 *
 * "Against the baseline", "External signals" and "Training runs" went the same
 * way; see `MlGaps`. Nothing stopped being measured.
 */
const GATE_COLUMNS: Column[] = [
  { key: "gate", label: "Gate" },
  { key: "passed", label: "Days passed", numeric: true },
  { key: "last", label: "Newest" },
  { key: "detail", label: "What it read" },
]

export function CounterMlClient({ sections }: { sections: SectionSources<MlSections> }) {
  usePageChrome({
    leaf: "Model health",
    askSuggestions: [
      "Does the forecast beat last week?",
      "Which gate is failing?",
    ],
  })
  const { pending } = useCounterTransition()

  return (
    <>
      <PageHead title="Model health" sub="Developer-facing · the nightly pipeline">
        {/* `viewTabs()` — the eight tabs are chrome on every one of
            them, not a table of links on the first. */}
        <SubNav items={MONITORING_TABS} label="Monitoring" />
      </PageHead>

      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <Strip cells={h.cells} />}
      </Section>

      <Section
        title="Forecast against actual"
        meta={(a) => a.meta}
        data={sections.accuracy}
        pending={pending}
        askAbout="how close the revenue forecast has been"
      >
        {(a) => (
          <>
            <Chart {...a.chart} fmt={(v) => money(v)} />
            <Note>
              {a.note}
            </Note>
          </>
        )}
      </Section>

      <Section
        title="Gates"
        meta={(g) => g.meta}
        data={sections.gates}
        pending={pending}
        pad={false}
        askAbout="which gate is failing"
      >
        {(g) => (
          <>
            <Table columns={GATE_COLUMNS} rows={g.rows} />
            {/* No `.sec__body` — a table section emits the table alone. */}
            <Note flush>
              {g.note}
            </Note>
          </>
        )}
      </Section>

      {/* `P.monml`'s "Known gaps". Derived rather than written down — see
          `MlGaps` — so the list is whatever is actually wrong tonight. */}
      <Section title="Known gaps" meta={(g) => g.meta} data={sections.gaps} pending={pending}>
        {(g) => <Queue items={g.items} />}
      </Section>
    </>
  )
}
