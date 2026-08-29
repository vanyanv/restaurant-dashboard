"use client"

import {
  MList,
  PageHead,
  Section,
  Strip,
  Table,
  useCounterTransition,
  usePageChrome,
  type Column,
} from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { MonitoringSections } from "@/lib/counter/adapters/monitoring"

/**
 * Monitoring, composed from `P.monitoring.desk()`:
 *
 *   strip -> subsystems -> recent events.
 *
 * `Sync duration` as a chart is dropped. `ExternalSignalSyncRun` carries a
 * `durationMs` per run, but the two providers in this account run three times
 * a day between them and one of them fails in under a second every time — a
 * bar chart of that is a picture of a dead integration's response latency,
 * which is not a thing anyone needs to see over time. The mean duration is a
 * column on the table instead.
 *
 * The masthead says "developer-facing" rather than the prototype's "not
 * visible to the owner" — see the page's own note on why no gate can deliver
 * the second claim.
 */
const TAB_COLUMNS: Column[] = [
  { key: "tab", label: "Page" },
  { key: "what", label: "What it answers" },
]

export type CounterMonitoringSections = SectionSources<MonitoringSections>

const SUBSYSTEM_COLUMNS: Column[] = [
  { key: "system", label: "System" },
  { key: "state", label: "State" },
  { key: "last", label: "Last run" },
  { key: "duration", label: "Mean", numeric: true },
  { key: "volume", label: "Volume", numeric: true },
  { key: "note", label: "Note" },
]

const ASK_SUGGESTIONS = [
  "Which syncs are failing?",
  "What errors were logged this week?",
  "How much is AI costing?",
]

export function CounterMonitoringClient({
  sections,
}: {
  sections: CounterMonitoringSections
}) {
  usePageChrome({ leaf: "Monitoring", askSuggestions: ASK_SUGGESTIONS })
  const { pending } = useCounterTransition()

  return (
    <>
      <PageHead
        title="System monitoring"
        sub="Developer-facing · the state of the things that run on their own"
      />

      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <Strip cells={h.cells} />}
      </Section>

      <Section
        title="The other pages"
        meta={(t) => t.meta}
        data={sections.tabs}
        pending={pending}
        pad={false}
      >
        {(t) => <Table columns={TAB_COLUMNS} rows={t.rows} />}
      </Section>

      <Section
        title="Subsystems"
        meta={(s) => s.meta}
        data={sections.subsystems}
        pending={pending}
        pad={false}
        askAbout="which syncs are failing"
      >
        {(s) => (
          <>
            <Table columns={SUBSYSTEM_COLUMNS} rows={s.rows} />
            {/* No `.sec__body` — a table section emits the table alone. */}
            <p className="mono" style={{ margin: 0, padding: "13px 15px" }}>
              {s.note}
            </p>
          </>
        )}
      </Section>

      <Section
        title="Recent events"
        meta={(e) => e.meta}
        data={sections.events}
        pending={pending}
        askAbout="what errors were logged this week"
      >
        {(e) => (
          <>
            <MList rows={e.rows} />
            <p className="mono" style={{ margin: "11px 0 0" }}>
              {e.note}
            </p>
          </>
        )}
      </Section>
    </>
  )
}
