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
import { money } from "@/lib/counter/format"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { MlSections } from "@/lib/counter/adapters/monitoring-ml"

/**
 * Model health — `P.monml`.
 *
 * The prototype's strip leads with "MAPE 8.4%" and "Beat the naive guess, 21
 * of 30". Both are inventions, and the second one is backwards: the revenue
 * model has beaten the seasonal-naive baseline 0 times in 187 evaluations. So
 * this page opens with a sentence, the way Activity does, because an accuracy
 * figure on its own reads fine and the comparison is the whole story.
 *
 * See the adapter for the measurements.
 */
const TARGET_COLUMNS: Column[] = [
  { key: "target", label: "Forecast" },
  { key: "wins", label: "Beat last week", numeric: true },
  { key: "wape", label: "Model error", numeric: true },
  { key: "baseline", label: "Baseline error", numeric: true },
  { key: "coverage", label: "Coverage, 80%", numeric: true },
  { key: "version", label: "Graded model" },
]

const GATE_COLUMNS: Column[] = [
  { key: "gate", label: "Gate" },
  { key: "passed", label: "Days passed", numeric: true },
  { key: "last", label: "Newest" },
  { key: "detail", label: "What it read" },
]

const SIGNAL_COLUMNS: Column[] = [
  { key: "provider", label: "Feed" },
  { key: "rows", label: "Rows written", numeric: true },
  { key: "runs", label: "Runs that worked", numeric: true },
  { key: "last", label: "Last good" },
  { key: "error", label: "Newest error" },
]

const RUN_COLUMNS: Column[] = [
  { key: "when", label: "Started" },
  { key: "target", label: "Forecast" },
  { key: "rows", label: "Training rows", numeric: true },
  { key: "status", label: "Result" },
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
        title="Forecast against actual"
        meta={(a) => a.meta}
        data={sections.accuracy}
        pending={pending}
        askAbout="how close the revenue forecast has been"
      >
        {(a) => (
          <>
            <Chart {...a.chart} fmt={(v) => money(v)} />
            <p className="mono" style={{ marginBottom: 0 }}>
              {a.note}
            </p>
          </>
        )}
      </Section>

      <Section
        title="Against the baseline"
        meta={(t) => t.meta}
        data={sections.targets}
        pending={pending}
        pad={false}
        askAbout="does the forecast beat last week"
      >
        {(t) => (
          <>
            <Table columns={TARGET_COLUMNS} rows={t.rows} />
            <p className="mono" style={{ margin: 0, padding: "13px 15px" }}>
              {t.note}
            </p>
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
            <p className="mono" style={{ margin: 0, padding: "13px 15px" }}>
              {g.note}
            </p>
          </>
        )}
      </Section>

      <Section
        title="External signals"
        meta={(g) => g.meta}
        data={sections.signals}
        pending={pending}
        pad={false}
        askAbout="are the weather and event feeds current"
      >
        {(g) => (
          <>
            <Table columns={SIGNAL_COLUMNS} rows={g.rows} />
            <p className="mono" style={{ margin: 0, padding: "13px 15px" }}>
              {g.note}
            </p>
          </>
        )}
      </Section>

      <Section
        title="Training runs"
        meta={(r) => r.meta}
        data={sections.runs}
        pending={pending}
        pad={false}
      >
        {(r) => (
          <>
            <Table columns={RUN_COLUMNS} rows={r.rows} />
            <p className="mono" style={{ margin: 0, padding: "13px 15px" }}>
              {r.note}
            </p>
          </>
        )}
      </Section>
    </>
  )
}
