"use client"

import {
  Chart,
  PageHead,
  Section,
  Strip,
  Table,
  useCounterTransition,
  usePageChrome,
  type Column,
} from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { ActivitySections } from "@/lib/counter/adapters/monitoring-people"

/**
 * Activity — `P.monactivity`.
 *
 * The page opens with a sentence, which is the prototype's own idea and a good
 * one: *"Seven panels in the app, which is too many to scan for the only
 * question this tab is ever opened with. So it opens with the answer in a
 * sentence, and the panels are the working."*
 *
 * The sentence is composed from the data rather than fixed, because on this
 * account the answer is not the prototype's "nothing here needs you".
 */
const ERROR_COLUMNS: Column[] = [
  { key: "when", label: "When" },
  { key: "where", label: "Where" },
  { key: "what", label: "What" },
]

const STORE_COLUMNS: Column[] = [
  { key: "store", label: "Store" },
  { key: "stage", label: "Stage" },
  { key: "last", label: "Last order" },
  { key: "orders", label: "Orders, 30d", numeric: true },
]

export function CounterActivityClient({
  sections,
}: {
  sections: SectionSources<ActivitySections>
}) {
  usePageChrome({
    leaf: "Activity",
    askSuggestions: ["What failed in the last day?", "Which stores are silent?"],
  })
  const { pending } = useCounterTransition()

  return (
    <>
      <PageHead title="Activity" sub="Developer-facing · errors, syncs, what happened" />

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
        title="Errors"
        meta={(e) => e.meta}
        data={sections.errors}
        pending={pending}
        askAbout="what failed in the last day"
      >
        {(e) => (
          <>
            <Chart {...e.chart} fmt={ERRORS} />
            <div style={{ marginTop: 12 }}>
              <Table columns={ERROR_COLUMNS} rows={e.rows} />
            </div>
            <p className="mono" style={{ margin: "11px 0 0" }}>
              {e.note}
            </p>
          </>
        )}
      </Section>

      <Section
        title="Stores reporting"
        meta={(s) => s.meta}
        data={sections.stores}
        pending={pending}
        pad={false}
        askAbout="which stores are silent"
      >
        {(s) => (
          <>
            <Table columns={STORE_COLUMNS} rows={s.rows} />
            <p className="mono" style={{ margin: 0, padding: "13px 15px" }}>
              {s.note}
            </p>
          </>
        )}
      </Section>
    </>
  )
}

const ERRORS = (v: number) => `${Math.round(v)} ${Math.round(v) === 1 ? "error" : "errors"}`
