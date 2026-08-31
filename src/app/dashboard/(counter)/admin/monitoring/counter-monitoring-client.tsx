"use client"

import {
  Chart,
  MList,
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
import type { MonitoringSections } from "@/lib/counter/adapters/monitoring"

/**
 * Monitoring, composed from `P.monitoring.desk()`:
 *
 *   strip -> subsystems -> sync duration -> recent events.
 *
 * Landmark for landmark, in that order. The prototype wraps the last two in a
 * `.split`; ours are siblings, which is invisible to the gate and identical on
 * the screen at this width.
 *
 * ## The eight tabs are chrome now, not a section
 *
 * This page carried a fifth section, "The other pages" — a two-column table of
 * the seven sibling monitoring routes and a sentence about each. It was
 * written when those pages were reachable only by typing the URL, and it fixed
 * that. But it also put a `.sec`, a `.sec__head` and a `.tbl` on a page whose
 * design has none of them, and it was the only reason this page could not be
 * gated: the fidelity structure pass never forgives an EXTRA.
 *
 * The design's own answer is `viewTabs()` — a `.seg` in `.phactions`, on every
 * one of the eight, which is what `SubNav` renders here. It is the better
 * answer regardless of the gate: a table of links is a page telling you where
 * else you could go, and a segmented control is the set you are already inside.
 * The sentences it drops were describing pages you are now one click from.
 *
 * The masthead says "developer-facing" rather than the prototype's "not
 * visible to the owner" — see the page's own note on why no gate can deliver
 * the second claim.
 */
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
      >
        {/* `viewTabs()` — the eight tabs are chrome on every one of
            them, not a table of links on the first. */}
        <SubNav items={MONITORING_TABS} label="Monitoring" />
      </PageHead>

      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <Strip cells={h.cells} />}
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

      {/* `P.monitoring`'s "Sync duration". `JobRun.durationMs` was already
          being written by every job and read by nothing. */}
      <Section
        title="Sync duration"
        meta={(d) => d.meta}
        data={sections.duration}
        pending={pending}
      >
        {(d) => (
          <>
            <Chart {...d.chart} fmt={SECONDS} />
            <p className="mono" style={{ margin: "11px 0 0" }}>
              {d.note}
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

/** The prototype's own axis unit on this panel. */
const SECONDS = (v: number) => `${v.toFixed(1)} s`
