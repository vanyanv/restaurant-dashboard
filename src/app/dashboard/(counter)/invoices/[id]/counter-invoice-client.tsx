"use client"

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
          {/* `P.invoice`'s `docPane()` — the DOCUMENT, not a description of
              it. "The stored PDF and what the model read out of it, side by
              side, because the failure that matters is a line the table never
              got" is the page's own note, and it only works if the PDF is
              actually here. This was a `.kv` of line counts and a button to
              open the file in a new tab; the counts are the note underneath
              (see `countsNote`), which says more than the list did, and the
              route already serves `Content-Disposition: inline`. */}
          {(d) => (
            <>
              {d.href ? (
                <object
                  className="docpane"
                  data={d.href}
                  type="application/pdf"
                  aria-label="The stored invoice PDF"
                >
                  {/* Rendered only where the browser cannot display a PDF —
                      no `.btn`, because it is a fallback rather than an
                      action the design puts on this panel. */}
                  <a href={d.href} target="_blank" rel="noreferrer">
                    Open the PDF
                  </a>
                </object>
              ) : null}
              <p className="mono" style={{ margin: d.href ? "11px 0 0" : 0 }}>
                {d.note}
              </p>
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
        askAbout="which lines match nothing in the catalogue"
      >
        {(l) => (
          <>
            <Table columns={LINE_COLUMNS} rows={l.rows} />
            {/* TWO `.sec__body` here, which is `P.invoice`'s own shape: the
                section wraps its whole body in one, and the arithmetic under
                the table gets a second of its own. This section keeps `pad`
                for that reason — it is the one table section in the product
                whose design puts the table inside a body. */}
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
