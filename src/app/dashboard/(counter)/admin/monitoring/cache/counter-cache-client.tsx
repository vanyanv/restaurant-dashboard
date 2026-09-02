"use client"

import {
  Kv,
  Note,
  PageHead,
  RankBars,
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
import type { CacheSections } from "@/lib/counter/adapters/monitoring-tabs"

/**
 * Cache — `P.moncache`. `nodate: true`, and honoured: 168 hours is the window
 * this page states, and there is no control to move it.
 *
 * It is a CHOICE, not a retention limit — the comment here used to say the
 * table only keeps that long, and it does not: `CacheStat` reaches back to
 * 2026-06-14. What the window really costs is on "The counters" below, which
 * reports how many of the 168 hours carry a row (60, when this was written).
 *
 * The table is sorted by MISSES. That is the prototype's own argument and it
 * holds here: the prefix with the best rate on this page has twenty-three
 * times the misses of the one with the worst.
 */
const COLUMNS: Column[] = [
  { key: "prefix", label: "Prefix" },
  { key: "hits", label: "Hits", numeric: true },
  { key: "misses", label: "Misses", numeric: true },
  { key: "rate", label: "Rate", numeric: true },
  { key: "failures", label: "Failures", numeric: true },
]

export function CounterCacheClient({
  sections,
}: {
  sections: SectionSources<CacheSections>
}) {
  usePageChrome({
    leaf: "Cache",
    askSuggestions: ["Which cache prefix is costing the most?", "What is the blended hit rate?"],
  })
  const { pending } = useCounterTransition()

  return (
    <>
      <PageHead title="Cache" sub="Developer-facing · 168 hours by prefix">
        {/* `viewTabs()` — the eight tabs are chrome on every one of
            them, not a table of links on the first. */}
        <SubNav items={MONITORING_TABS} label="Monitoring" />
      </PageHead>

      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <Strip cells={h.cells} />}
      </Section>

      <Section
        title="By prefix"
        meta={(p) => p.meta}
        data={sections.prefixes}
        pending={pending}
        pad={false}
        askAbout="which cache prefix is costing the most"
      >
        {(p) => (
          <>
            <Table columns={COLUMNS} rows={p.rows} />
            {/* No `.sec__body` — a table section emits the table alone. */}
            <Note flush>
              {p.note}
            </Note>
          </>
        )}
      </Section>

      {/* `P.moncache`'s "Redis, live". There is no Redis — the cache is
          `CacheStat` — so this is the same panel asked of the table we do
          have, and two of its six rows appear nowhere else on the page: the
          writes a miss should have produced, and how much of the 168-hour
          window carries a row at all. See `CacheLive`. */}
      <Section
        title="The counters"
        meta={(l) => l.meta}
        data={sections.live}
        pending={pending}
      >
        {(l) => (
          <>
            <Kv rows={l.rows} />
            <Note>
              {l.note}
            </Note>
          </>
        )}
      </Section>

      {/* `P.moncache`'s third panel. The same prefixes as the table above,
          ranked the same way and drawn rather than listed — which is the
          page's own argument that a blended rate hides a cold prefix behind
          warm ones. `RankBars` is the port of the prototype's `.rankbar`. */}
      <Section
        title="Where the misses are"
        meta={(m) => m.meta}
        data={sections.misses}
        pending={pending}
      >
        {(m) => (
          <>
            <RankBars rows={m.rows} />
            <Note>
              {m.note}
            </Note>
          </>
        )}
      </Section>
    </>
  )
}
