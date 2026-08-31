"use client"

import {
  Kv,
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
import type { InfraSections } from "@/lib/counter/adapters/monitoring-infra"

/**
 * Infrastructure — `P.moninfra`.
 *
 * The prototype's note is *"Three panels that each load on their own, so the
 * database block can still be spinning while storage and tokens have already
 * answered. That is why this page needs the states kit more than any other."*
 * That part is kept exactly: every section here is its own Suspense boundary
 * fed by one shared query, so a slow block never holds a fast one.
 *
 * Composed as `P.moninfra.desk()` composes it: strip -> a table -> a `.kv`
 * panel -> a table -> a closing paragraph outside any section.
 *
 * Two substitutions, both because the data is different and neither hidden:
 *
 *   - The first table is SCHEDULED JOBS where the design has TOKENS. Nothing
 *     in this database holds a credential's expiry, so the prototype's five
 *     rows with a green "OK" against four of them would be decoration reading
 *     as a check that ran. The slot asks "which of the things that run on
 *     their own are in trouble", and `JobRun` answers it.
 *   - The `.kv` is FILES where the design has R2 BUCKET, which is the same
 *     panel under the name this product uses for it.
 *
 * What was dropped to get here: a verdict block (`P.moninfra` has none — that
 * is `P.monactivity`'s device, and its figures are in the strip), an Errors
 * table (`ErrorEvent` belongs to the Activity tab, which draws it by hour and
 * at a finer grain), and a three-row `.kv` of things not recorded, which is
 * the closing paragraph now.
 */
const JOB_COLUMNS: Column[] = [
  { key: "job", label: "Job" },
  { key: "runs", label: "Runs", numeric: true },
  { key: "failures", label: "Failed", numeric: true },
  { key: "mean", label: "Mean", numeric: true },
  { key: "last", label: "Last run" },
  { key: "error", label: "Newest message" },
]

const TABLE_COLUMNS: Column[] = [
  { key: "table", label: "Table" },
  { key: "rows", label: "Rows", numeric: true },
  { key: "size", label: "Size", numeric: true },
  { key: "share", label: "Share", numeric: true },
]

export function CounterInfraClient({ sections }: { sections: SectionSources<InfraSections> }) {
  usePageChrome({
    leaf: "Infrastructure",
    askSuggestions: ["Which jobs are failing?", "What is the database made of?"],
  })
  const { pending } = useCounterTransition()

  return (
    <>
      <PageHead
        title="Infrastructure"
        sub="Developer-facing · storage, jobs, what broke"
      >
        {/* `viewTabs()` — the eight tabs are chrome on every one of
            them, not a table of links on the first. */}
        <SubNav items={MONITORING_TABS} label="Monitoring" />
      </PageHead>

      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <Strip cells={h.cells} />}
      </Section>

      <Section
        title="Scheduled jobs"
        meta={(j) => j.meta}
        data={sections.jobs}
        pending={pending}
        pad={false}
        askAbout="which jobs are failing"
      >
        {(j) => (
          <>
            <Table columns={JOB_COLUMNS} rows={j.rows} />
            {/* No `.sec__body` — a table section emits the table alone. */}
            <p className="mono" style={{ margin: 0, padding: "13px 15px" }}>
              {j.note}
            </p>
          </>
        )}
      </Section>

      <Section title="Files" meta={(f) => f.meta} data={sections.files} pending={pending}>
        {(f) => (
          <>
            <Kv rows={f.rows} />
            <p className="mono" style={{ marginBottom: 0 }}>
              {f.note}
            </p>
          </>
        )}
      </Section>

      <Section
        title="What the database is made of"
        meta={(s) => s.meta}
        data={sections.storage}
        pending={pending}
        pad={false}
        askAbout="what the database is made of"
      >
        {(s) => (
          <>
            <Table columns={TABLE_COLUMNS} rows={s.rows} />
            <p className="mono" style={{ margin: 0, padding: "13px 15px" }}>
              {s.note}
            </p>
          </>
        )}
      </Section>

      {/* `P.moninfra`'s trailing `<p class="mono">`, outside any section —
          the design's own device for a closing argument, and `bare` is how a
          Section renders one without becoming a panel. See `InfraGaps`. */}
      <Section bare title="What this page cannot tell you" data={sections.gaps} pending={pending}>
        {(g) => (
          <p className="mono" style={{ margin: "2px 0 0" }}>
            {g.note}
          </p>
        )}
      </Section>
    </>
  )
}
