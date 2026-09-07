"use client"

import { Section } from "@/components/counter/surface/section"
import { Chart } from "@/components/counter/surface/chart"
import { Table, type Column, type Row } from "@/components/counter/surface/table"
import { money, count, pct, plural } from "@/lib/counter/format"
import type { PresentFormat, PresentChart, PresentTable } from "@/lib/chat/present"
import type { ShownPresentation } from "@/lib/chat/return"

/**
 * The picture an answer draws, in the primitives the pages draw with.
 *
 * The prototype's Ask page (`P.ask`, line 4504) is two `sec()`s under the
 * verdict — one holding a `chart()`, one holding a `tbl()` — and the fidelity
 * report has been counting them as missing since the page shipped: `.sec` 2/0,
 * `.sec__head` 2/0, `.sec__body` 1/0, `.ch` 1/0, `.tbl` 2/0. This is those
 * landmarks, rendered from a real tool result rather than the prototype's
 * invented one.
 *
 * ## Why `Section`, `Chart` and `Table` and not markup of its own
 *
 * The whole argument for the answer showing a picture is that it is THE SAME
 * picture the page would draw. A hand-rolled chart in an answer would be a
 * second renderer of the same figures, and the codebase already knows what
 * that costs — `AskAnswerBody`'s own note: "a second renderer is how two
 * surfaces come to disagree about what an answer looks like." So a chart in an
 * answer is `Chart`, hit-testing and tooltip and draw-on and all, and a table
 * is `Table`, down to the FLIP animation on re-order.
 *
 * `Section` is passed a `ready` SectionData because a presentation that
 * reached this component has already been parsed and shape-checked by
 * `selectPresentations` — there is no pending, failed or empty presentation.
 * The value of going through `Section` anyway is the DOM: `.sec`,
 * `.sec__head`, the `h3`, the `.k` meta, and `pad={false}` dropping
 * `.sec__body` for a table exactly as `raw()`/`tbl()` do in the prototype.
 *
 * ## No `askAbout`
 *
 * Every other section on every other page carries "Ask about this". This one
 * cannot: it is already inside an answer, so the button would open the palette
 * over the answer to ask about the answer.
 */

/**
 * A chart cannot carry a formatter over the wire, so the payload names one and
 * this resolves it — to the same three functions `format.ts` gives the pages.
 * A figure inside an answer is written the way the same figure is written on
 * the page the question was asked from, which is the entire point.
 */
const FORMATTERS: Record<PresentFormat, (v: number) => string> = {
  money: (v) => money(v),
  count: (v) => count(v),
  pct: (v) => pct(v),
}

function ChartBlock({ present }: { present: PresentChart }) {
  const fmt = FORMATTERS[present.fmt] ?? FORMATTERS.money
  return (
    <Section title={present.title} data={{ status: "ready", data: present }}>
      {(p) => <Chart {...p.spec} fmt={fmt} />}
    </Section>
  )
}

/**
 * `more` is printed, not swallowed.
 *
 * The payload caps at twelve rows, which answers "which is biggest" perfectly
 * and answers "how many are there" wrongly. A table that says "12 of 47" is
 * doing what the rest of the answer does — naming the limits of what it read.
 */
function tableMeta(present: PresentTable): string {
  const shown = present.rows.length
  if (present.more > 0) return `${shown} of ${shown + present.more} rows`
  return plural(shown, "row")
}

function TableBlock({ present }: { present: PresentTable }) {
  const columns: Column[] = present.columns.map((c) => ({
    key: c.key,
    label: c.label,
    ...(c.numeric ? { numeric: true } : {}),
  }))
  // Inert rows: a cell in an answer opens nothing. The pages' tables navigate
  // because a row there IS a record; here it is a reading the answer quoted,
  // and a link would take the reader off the answer they asked for.
  const rows: Row[] = present.rows.map((r) => ({ key: r.key, cells: r.cells }))
  return (
    <Section
      title={present.title}
      meta={tableMeta(present)}
      pad={false}
      data={{ status: "ready", data: { columns, rows } }}
    >
      {(t) => <Table columns={t.columns} rows={t.rows} />}
    </Section>
  )
}

export function AskShowBody({ shown }: { shown: readonly ShownPresentation[] }) {
  return (
    <>
      {shown.map(({ tool, present }) =>
        present.kind === "chart" ? (
          <ChartBlock key={tool} present={present} />
        ) : (
          <TableBlock key={tool} present={present} />
        ),
      )}
    </>
  )
}
