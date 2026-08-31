"use client"

import {
  Kv,
  PageHead,
  Queue,
  Section,
  Strip,
  Table,
  useCounterTransition,
  usePageChrome,
  type Column,
} from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { CountSessionSections } from "@/lib/counter/adapters/stock-counts"

/**
 * One count session — `P.countsession`.
 *
 * No `DateControl`: a count happened at a time, and a range cannot narrow one.
 * The `Variance` section is the list page's own, unchanged — the reason a
 * variance cannot be stated is a property of the account rather than of this
 * session, and telling it differently in two places would be two explanations
 * of one absence.
 */
const LINE_COLUMNS: Column[] = [
  { key: "ingredient", label: "Ingredient" },
  { key: "native", label: "Counted as", numeric: true },
  { key: "qty", label: "In recipe units", numeric: true },
  { key: "cost", label: "Unit cost", numeric: true },
  { key: "value", label: "Value", numeric: true },
]

const ASK_SUGGESTIONS = [
  "What was counted in this session?",
  "Why does this count have no variance?",
]

export function CounterCountSessionClient({
  title,
  sections,
}: {
  title: string
  sections: SectionSources<CountSessionSections>
}) {
  usePageChrome({ leaf: title, askSuggestions: ASK_SUGGESTIONS })

  const { pending } = useCounterTransition()

  return (
    <>
      <PageHead title={title} sub="Stock count" />

      <Section bare title="The figures" data={sections.head} pending={pending}>
        {(h) => (
          <>
            <p className="mono" style={{ margin: "0 0 11px" }}>
              {h.sub}
            </p>
            <Strip cells={h.cells} />
          </>
        )}
      </Section>

      <Section
        title="What was counted"
        meta={(l) => l.meta}
        data={sections.lines}
        pending={pending}
        pad={false}
        askAbout="what was counted in this session"
      >
        {(l) => (
          <>
            <Table columns={LINE_COLUMNS} rows={l.rows} />
            {/* No `.sec__body` — `P.countsession`'s Lines section is a table
                and nothing else, and the counted-stock total this used to
                repeat here is the strip's second cell. */}
            <p className="mono" style={{ margin: 0, padding: "13px 15px" }}>
              {l.note}
            </p>
          </>
        )}
      </Section>

      {/* `P.countsession`'s "What it taught the model" — same shape, a
          paragraph and a `.kv`, and the same subject: this one lists what a
          calibration would need instead of what it learned. */}
      <Section title="Variance" meta={(v) => v.meta} data={sections.variance} pending={pending}>
        {(v) => (
          <>
            <p className="ans__lead" style={{ margin: "0 0 14px" }}>
              {v.lead}
            </p>
            <Kv rows={v.rows} />
            <p className="mono" style={{ margin: "11px 0 0" }}>
              {v.note}
            </p>
          </>
        )}
      </Section>

      {/* `P.countsession`'s "What to do". Its own item is a variance pattern
          across counts, which needs an expected quantity; ours is about the
          session itself. See `CountSessionWork`. */}
      <Section title="What to do" meta={(w) => w.meta} data={sections.work} pending={pending}>
        {(w) => <Queue items={w.items} />}
      </Section>
    </>
  )
}
