"use client"

import {
  Kv,
  MoneyLines,
  Note,
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
import { markInvoiceReturn, resolveInvoiceReview } from "@/lib/counter/actions/invoice"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

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

/**
 * THE DECISION, BESIDE THE ARGUMENT FOR IT.
 *
 * The prototype's invoice page is a record and nothing else, and this page
 * was a faithful port of it: it rendered `reviewReasons` beautifully and
 * offered the reader no way to answer them. An owner who agreed with the
 * flag, or disagreed with it, closed the tab either way, and the REVIEW
 * queue only ever grew. `Invoice.status` has had APPROVED and REJECTED the
 * whole time; no screen has ever written them.
 *
 * It lives inside "Why this is in review" rather than on the masthead
 * because the two belong to each other. The reasons are the case; these
 * are the verdict. Putting the buttons anywhere else would ask the reader
 * to hold the argument in their head while they walk to the control.
 *
 * Three states, and the section renders exactly one:
 *
 *   - **REVIEW** — the decision is open. Approve and Reject.
 *   - **APPROVED / REJECTED** — the decision is made and named, with a way
 *     back. Reopening is a first-class action, not a hidden one: a wrong
 *     approval that cannot be undone is worse than no approval button.
 *   - **anything else** (PENDING, MATCHED) — no verdict is being asked for,
 *     so none is offered.
 *
 * The return toggle sits here too because it is the other thing an owner
 * decides about a whole document, and because "the totals look wrong" is
 * very often "this is a credit memo, not a bill" — the answer to the flag
 * rather than an override of it.
 */
function ReviewDecision({
  invoiceId,
  status,
  isReturn,
}: {
  invoiceId: string
  status: string
  isReturn: boolean
}) {
  const router = useRouter()
  const [saving, startSaving] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const decide = (decision: "APPROVED" | "REJECTED" | "REVIEW") => {
    setError(null)
    startSaving(async () => {
      const result = await resolveInvoiceReview(invoiceId, decision)
      if (!result.ok) {
        setError(result.error)
        return
      }
      // The status is read by the section that just wrote it, and by the
      // review count on Invoices and Operations. Refresh rather than patch
      // local state so every one of them re-reads the same row.
      router.refresh()
    })
  }

  const toggleReturn = () => {
    setError(null)
    startSaving(async () => {
      const result = await markInvoiceReturn(invoiceId, !isReturn)
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.refresh()
    })
  }

  const decided = status === "APPROVED" || status === "REJECTED"

  return (
    <div style={{ marginTop: 13 }}>
      {status === "REVIEW" ? (
        <div className="btnrow">
          <button
            className="btn btn--primary"
            type="button"
            disabled={saving}
            onClick={() => decide("APPROVED")}
          >
            {saving ? "Saving…" : "Approve this invoice"}
          </button>
          <button
            className="btn"
            type="button"
            disabled={saving}
            onClick={() => decide("REJECTED")}
          >
            Reject
          </button>
        </div>
      ) : null}

      {decided ? (
        <div className="btnrow">
          <button
            className="btn btn--quiet"
            type="button"
            disabled={saving}
            onClick={() => decide("REVIEW")}
          >
            {saving ? "Saving…" : "Reopen the review"}
          </button>
        </div>
      ) : null}

      <div className="btnrow" style={{ marginTop: 8 }}>
        <button
          className="btn btn--quiet"
          type="button"
          disabled={saving}
          onClick={toggleReturn}
        >
          {isReturn ? "This is a bill, not a credit" : "Record this as a credit / return"}
        </button>
      </div>

      {error ? (
        <Note tight>
          {error === "forbidden"
            ? "This account cannot change an invoice's status."
            : `The decision did not save (${error}).`}
        </Note>
      ) : null}
    </div>
  )
}

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
            <Note lede>
              {h.sub}
            </Note>
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
              <Note bare={!d.href}>{d.note}</Note>
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
                    <Note tight>
                      {row.lines}
                    </Note>
                  ) : null}
                </div>
              ))}
              <Note bare>
                {r.note}
              </Note>
              <ReviewDecision
                invoiceId={r.invoiceId}
                status={r.status}
                isReturn={r.isReturn}
              />
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
              <Note>
                {l.note}
              </Note>
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
              <Note>
                {p.matching.note}
              </Note>
            </>
          )}
        </Section>
      </div>
    </>
  )
}
