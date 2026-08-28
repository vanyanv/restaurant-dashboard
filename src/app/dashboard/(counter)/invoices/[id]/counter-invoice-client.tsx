"use client"

import Link from "next/link"
import {
  Kv,
  MoneyLines,
  PageHead,
  Section,
  Strip,
  Table,
  useCounterTransition,
  usePageChrome,
  type Column,
  type SwitchableStore,
} from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { InvoiceSections } from "@/lib/counter/adapters/invoice"

/**
 * One invoice, composed from `P.invoice.desk()`:
 *
 *   strip -> a split of the document and the review reasons -> the extracted
 *   lines with the arithmetic under them -> three provenance panels.
 *
 * The adapter's docblock argues the central departure: the prototype's whole
 * frame is "18 of 19 lines extracted", and **nothing in this schema records
 * how many lines the document had.** The printed subtotal is the only evidence
 * a line went missing, so the gap is stated against that.
 *
 * No `DateControl`. `P.invoice` sets `nodate: true` and it is right — an
 * invoice is a record, and a date range cannot narrow one.
 */
export type CounterInvoiceSections = SectionSources<InvoiceSections>

const LINE_COLUMNS: Column[] = [
  { key: "n", label: "#", numeric: true },
  { key: "product", label: "Product" },
  { key: "qty", label: "Qty", numeric: true },
  { key: "price", label: "Unit", numeric: true },
  { key: "ext", label: "Extended", numeric: true },
  { key: "matched", label: "Matched to" },
]

const ASK_SUGGESTIONS = [
  "Why is this invoice in review?",
  "Which lines match nothing in the catalogue?",
  "Does this invoice tie out?",
]

export function CounterInvoiceClient({
  stores,
  title,
  vendor,
  sections,
}: {
  stores: SwitchableStore[]
  title: string
  vendor: string
  sections: CounterInvoiceSections
}) {
  void stores
  usePageChrome({ leaf: title, askSuggestions: ASK_SUGGESTIONS })

  const { pending } = useCounterTransition()

  return (
    <>
      <PageHead title={title} sub={vendor} />

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

      <div className="split">
        <Section
          title="The document"
          meta={(d) => d.meta}
          data={sections.document}
          pending={pending}
        >
          {(d) => (
            <>
              <Kv rows={d.rows} />
              <p className="mono" style={{ margin: "11px 0 0" }}>
                {d.note}
              </p>
              {d.href ? (
                <div className="btnrow" style={{ marginTop: 12 }}>
                  <Link className="btn btn--primary" href={d.href} target="_blank" rel="noreferrer">
                    Open the PDF
                  </Link>
                </div>
              ) : null}
            </>
          )}
        </Section>

        <Section
          title="Why this is in review"
          meta={(r) => r.meta}
          data={sections.reasons}
          pending={pending}
          askAbout="why is this invoice in review"
        >
          {(r) => (
            <>
              {r.rows.map((row) => (
                <div key={row.key} style={{ marginBottom: 11 }}>
                  <span className="k">{row.kind}</span>
                  <p style={{ margin: "3px 0 0", fontSize: "var(--t-cap)", lineHeight: 1.5 }}>
                    {row.message}
                  </p>
                  {row.lines ? (
                    <p className="mono" style={{ margin: "2px 0 0" }}>
                      {row.lines}
                    </p>
                  ) : null}
                </div>
              ))}
              <p className="mono" style={{ margin: 0 }}>
                {r.note}
              </p>
            </>
          )}
        </Section>
      </div>

      <Section
        title="What was extracted"
        meta={(l) => l.meta}
        data={sections.lines}
        pending={pending}
        pad={false}
        askAbout="which lines match nothing in the catalogue"
      >
        {(l) => (
          <>
            <Table columns={LINE_COLUMNS} rows={l.rows} />
            {/* `.sec__body` restores the padding a `pad={false}` section drops,
                because the arithmetic below the table is body content rather
                than another row. */}
            <div className="sec__body">
              <MoneyLines rows={l.money} />
              <p className="mono" style={{ margin: "11px 0 0" }}>
                {l.note}
              </p>
            </div>
          </>
        )}
      </Section>

      <div className="split">
        <Section
          title="How it got here"
          meta={(p) => p.arrival.meta}
          data={sections.panels}
          pending={pending}
        >
          {(p) => <Kv rows={p.arrival.rows} />}
        </Section>

        <Section
          title="What we store"
          meta={(p) => p.storage.meta}
          data={sections.panels}
          pending={pending}
        >
          {(p) => <Kv rows={p.storage.rows} />}
        </Section>

        <Section
          title="Matching"
          meta={(p) => p.matching.meta}
          data={sections.panels}
          pending={pending}
        >
          {(p) => (
            <>
              <Kv rows={p.matching.rows} />
              <p className="mono" style={{ margin: "11px 0 0" }}>
                {p.matching.note}
              </p>
            </>
          )}
        </Section>
      </div>
    </>
  )
}
