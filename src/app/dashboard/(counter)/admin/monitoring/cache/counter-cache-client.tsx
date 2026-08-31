"use client"

import {
  PageHead,
  RankBars,
  Section,
  Strip,
  Table,
  useCounterTransition,
  usePageChrome,
  type Column,
} from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { CacheSections } from "@/lib/counter/adapters/monitoring-tabs"

/**
 * Cache — `P.moncache`. `nodate: true`, and honoured: the window is 168 hours
 * because that is what `CacheStat` retains, not because a reader chose it.
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
      <PageHead title="Cache" sub="Developer-facing · 168 hours by prefix" />

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
            <p className="mono" style={{ margin: 0, padding: "13px 15px" }}>
              {p.note}
            </p>
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
            <p className="mono" style={{ margin: "11px 0 0" }}>
              {m.note}
            </p>
          </>
        )}
      </Section>
    </>
  )
}
