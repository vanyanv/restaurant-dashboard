"use client"

import {
  Chart,
  Lede,
  Note,
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
import type { PeopleSections } from "@/lib/counter/adapters/monitoring-people"

/**
 * People — `P.monpeople`.
 *
 * The prototype's strip is sessions, median session, opens per day and phone
 * share. Three of those need session boundaries this product does not record;
 * what it records is sign-ins and page views, and the tab's own question —
 * "whether the thing gets opened" — is answerable from those without inventing
 * a session. See the adapter for the answer, which is that the owner has
 * opened it twice.
 *
 * Composed as `P.monpeople.desk()` composes it: strip -> a chart -> the pages
 * table -> a verdict in prose. The chart is readings per day rather than
 * sessions (`PeopleReadings`) and the verdict is where the two-row "Who opens
 * it" table went (`PeopleVerdict`) — a six-column table with one row per
 * account, on an installation with two accounts, was a sentence wearing a
 * table's clothes, and the prototype puts its strongest claim in prose here
 * for the same reason.
 */
const PAGE_COLUMNS: Column[] = [
  { key: "page", label: "Page" },
  { key: "views", label: "Views", numeric: true },
  { key: "median", label: "Median time", numeric: true },
  { key: "share", label: "Share", numeric: true },
]

export function CounterPeopleClient({
  sections,
}: {
  sections: SectionSources<PeopleSections>
}) {
  usePageChrome({
    leaf: "People",
    askSuggestions: ["Has the owner opened the dashboard?", "Which pages get read?"],
  })
  const { pending } = useCounterTransition()

  return (
    <>
      <PageHead title="People" sub="Developer-facing · who is actually using it">
        {/* `viewTabs()` — the eight tabs are chrome on every one of
            them, not a table of links on the first. */}
        <SubNav items={MONITORING_TABS} label="Monitoring" />
      </PageHead>

      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <Strip cells={h.cells} />}
      </Section>

      {/* `P.monpeople`'s "Sessions". Readings rather than sessions, because
          nothing here records where one visit ends — see `PeopleReadings`. */}
      <Section
        title="Readings"
        meta={(r) => r.meta}
        data={sections.readings}
        pending={pending}
        askAbout="has the owner opened the dashboard"
      >
        {(r) => (
          <>
            <Chart {...r.chart} fmt={READINGS} />
            <Note>
              {r.note}
            </Note>
          </>
        )}
      </Section>

      <Section
        title="Which pages get opened"
        meta={(p) => p.meta}
        data={sections.pages}
        pending={pending}
        pad={false}
        askAbout="which pages get read"
      >
        {(p) => (
          <>
            <Table columns={PAGE_COLUMNS} rows={p.rows} />
            <Note flush>
              {p.note}
            </Note>
          </>
        )}
      </Section>

      {/* `P.monpeople`'s "What this tells you" — a claim in body type and a
          caveat in mono, which is where the two-row "Who opens it" table
          went. See `PeopleVerdict`. */}
      <Section title="What this tells you" data={sections.verdict} pending={pending}>
        {(v) => (
          <>
            <Lede>
              {v.lead}
            </Lede>
            <Note bare>
              {v.note}
            </Note>
          </>
        )}
      </Section>
    </>
  )
}

/** The chart's own unit. */
const READINGS = (v: number) => `${v} ${v === 1 ? "reading" : "readings"}`
