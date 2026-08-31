"use client"

import {
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
 */
const WHO_COLUMNS: Column[] = [
  { key: "who", label: "Account" },
  { key: "role", label: "Role" },
  { key: "views", label: "Page views", numeric: true },
  { key: "real", label: "Over 3s", numeric: true },
  { key: "signins", label: "Sign-ins", numeric: true },
  { key: "last", label: "Last seen" },
]

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

      <Section
        title="Who opens it"
        meta={(w) => w.meta}
        data={sections.who}
        pending={pending}
        pad={false}
        askAbout="has the owner opened the dashboard"
      >
        {(w) => (
          <>
            <Table columns={WHO_COLUMNS} rows={w.rows} />
            {/* No `.sec__body` — a table section emits the table alone. */}
            <p className="mono" style={{ margin: 0, padding: "13px 15px" }}>
              {w.note}
            </p>
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
            <p className="mono" style={{ margin: 0, padding: "13px 15px" }}>
              {p.note}
            </p>
          </>
        )}
      </Section>
    </>
  )
}
