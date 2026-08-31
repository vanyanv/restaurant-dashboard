"use client"

import {
  Chart,
  PageHead,
  Section,
  Strip,
  SubNav,
  Table,
  useCounterTransition,
  usePageChrome,
  type Column,
} from "@/components/counter"
import { MONITORING_TABS } from "@/lib/counter/nav"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { CostsSections } from "@/lib/counter/adapters/monitoring-tabs"

/**
 * Costs — `P.moncosts`.
 *
 * The strip's fourth cell counts calls that recorded $0, and the prototype's
 * reasoning for it is the whole page: a bar that is short because nothing ran
 * and a bar that is short because the cost was never written look identical.
 * 28 of this account's 995 AI events recorded exactly zero.
 */
const COLUMNS: Column[] = [
  { key: "feature", label: "Feature" },
  { key: "model", label: "Model" },
  { key: "calls", label: "Calls", numeric: true },
  { key: "cost", label: "Cost", numeric: true },
  { key: "share", label: "Share", numeric: true },
  { key: "zero", label: "Recorded $0", numeric: true },
]

export function CounterCostsClient({
  sections,
}: {
  sections: SectionSources<CostsSections>
}) {
  usePageChrome({
    leaf: "Costs",
    askSuggestions: ["How much is AI costing?", "Which feature spends the most?"],
  })
  const { pending } = useCounterTransition()

  return (
    <>
      <PageHead title="Costs" sub="Developer-facing · what the model layer spends">
        {/* `viewTabs()` — the eight tabs are chrome on every one of
            them, not a table of links on the first. */}
        <SubNav items={MONITORING_TABS} label="Monitoring" />
      </PageHead>

      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <Strip cells={h.cells} />}
      </Section>

      <Section
        title="Spend by day"
        meta={(s) => s.meta}
        data={sections.spend}
        pending={pending}
        askAbout="how much is AI costing"
      >
        {(s) => (
          <>
            <Chart {...s.chart} fmt={USD} />
            <p className="mono" style={{ margin: "9px 0 0" }}>
              {s.note}
            </p>
          </>
        )}
      </Section>

      <Section
        title="By feature"
        meta={(f) => f.meta}
        data={sections.features}
        pending={pending}
        pad={false}
      >
        {(f) => (
          <>
            <Table columns={COLUMNS} rows={f.rows} />
            <p className="mono" style={{ margin: 0, padding: "13px 15px" }}>
              {f.note}
            </p>
          </>
        )}
      </Section>

      {/* `P.moncosts`' fourth panel. All-time rather than windowed — see the
          adapter: eight turns have ever failed and none recently, so the
          fourteen-day scope this page otherwise uses would draw an empty
          table over a real record. */}
      <Section
        title="Turns that were not OK"
        meta={(f) => f.meta}
        data={sections.failures}
        pending={pending}
        pad={false}
      >
        {(f) => (
          <>
            <Table columns={FAILURE_COLUMNS} rows={f.rows} />
            <p className="mono" style={{ margin: 0, padding: "13px 15px" }}>
              {f.note}
            </p>
          </>
        )}
      </Section>
    </>
  )
}

const FAILURE_COLUMNS: Column[] = [
  { key: "when", label: "When" },
  { key: "feature", label: "Feature" },
  { key: "outcome", label: "Outcome" },
  { key: "cost", label: "Cost", numeric: true },
]

/** Cents matter here — the whole month is under a dollar. */
const USD = (v: number) => `$${v.toFixed(3)}`
