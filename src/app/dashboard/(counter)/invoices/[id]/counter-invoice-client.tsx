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
 * THE DECISION THE PROTOTYPE ASKED FOR, IN THE PLACE IT ASKED FOR IT.
 *
 * `P.invoice` draws one `.btnrow` inside "What was extracted", under the money
 * lines: "Approve and post", "Add the missing line", "Send back to vendor",
 * with the primary DISABLED and a note reading "Approve unlocks when the gap
 * is zero". The invoices list that leads here is noted "a list that ends in a
 * decision, and a review that will not let you approve a gap". None of it was
 * built — the page rendered `reviewReasons` beautifully and offered the reader
 * no way to answer them, so an owner who agreed with a flag and one who
 * disagreed both closed the tab, and the REVIEW queue only grew.
 *
 * `e2e/fidelity/manifest.ts` had declared those four landmarks absent and left
 * the route: "`PATCH /api/invoices/[id]` already accepts `status: "APPROVED"`
 * and stamps `matchedAt`, so approving is one call away… Whoever wants it has
 * the shortest path written down here." Those allowances are deleted in the
 * same commit as this component.
 *
 * ## THE GATE IS THE POINT, NOT THE BUTTONS
 *
 * Approving posts an invoice to COGS. An invoice whose extracted lines do not
 * sum to its own printed total is one where a line went missing, and posting
 * it puts a number into COGS that the document itself contradicts. So the
 * primary is disabled exactly while `reconciles` is false, which is the
 * adapter's `gap === null`, and the note says why rather than leaving a dead
 * control to look broken. That is the whole meaning of "a review that will not
 * let you approve a gap", and it is the reason this control belongs under the
 * arithmetic instead of up beside the review reasons where a first draft put
 * it: the gate and the figure it reads have to be in the same section.
 *
 * Rejecting and marking a credit stay available on a gapped invoice. Both are
 * ways of saying the document is wrong, and refusing them would leave an
 * owner looking at a bad invoice with nothing they are allowed to do.
 *
 * ## THREE SLOTS, FILLED WITH VERBS WE ACTUALLY HAVE
 *
 * The shape is the fixture's — one `.btnrow`, a `.btn--primary`, a `.btn`, a
 * `.btn--quiet`. Two of its three labels are not reproduced, because two of
 * its verbs do not exist here and inventing them is what this codebase
 * refuses to do: nothing creates an `InvoiceLineItem` by hand, so the middle
 * slot takes the credit/return toggle (very often the true answer when the
 * totals look wrong), and the mail integration reads an inbox rather than
 * replying to one, so the quiet slot records Reject where we can keep it.
 *
 * ## THE SHAPE DOES NOT CHANGE WITH THE STATUS
 *
 * A first draft showed Approve/Reject only on a REVIEW invoice and Reopen only
 * on a decided one. `npm run fidelity` refused it, for a better reason than
 * the one it prints: an allowance names an EXACT count, so a control set that
 * changes shape with the row's status is one the gate can never hold again.
 * Fixed slots with labels carrying the state is also the better design —
 * every status offers a way forward and a way back, and an owner who changes
 * their mind reaches for the control they used the first time.
 */
function ReviewDecision({
  invoiceId,
  status,
  isReturn,
  reconciles,
}: {
  invoiceId: string
  status: string
  isReturn: boolean
  reconciles: boolean
}) {
  const router = useRouter()
  const [saving, startSaving] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const run = (work: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setError(null)
    startSaving(async () => {
      const result = await work()
      if (!result.ok) {
        setError(result.error)
        return
      }
      // The status is read by the section that just wrote it, and by the review
      // counts on Invoices and Operations. Refresh rather than patch local
      // state so none of them can disagree with the row just decided.
      router.refresh()
    })
  }

  const decide = (to: "APPROVED" | "REJECTED" | "REVIEW") =>
    run(() => resolveInvoiceReview(invoiceId, to))

  /** The affirmative move available from where this invoice stands. */
  const primary =
    status === "APPROVED"
      ? { label: "Reopen the review", to: "REVIEW" as const, gated: false }
      : { label: "Approve and post", to: "APPROVED" as const, gated: true }

  /** Its opposite — never the same target as the primary. */
  const quiet =
    status === "REJECTED"
      ? { label: "Reopen the review", to: "REVIEW" as const }
      : status === "REVIEW" || status === "APPROVED"
        ? { label: "Reject", to: "REJECTED" as const }
        : // PENDING / MATCHED: nothing has asked for a verdict, but an owner
          // who distrusts the document can still put it in the queue.
          { label: "Send to review", to: "REVIEW" as const }

  const blocked = primary.gated && !reconciles

  return (
    <>
      <div className="btnrow" style={{ marginTop: 12 }}>
        <button
          className="btn btn--primary"
          type="button"
          disabled={saving || blocked}
          onClick={() => decide(primary.to)}
        >
          {saving ? "Saving…" : primary.label}
        </button>
        <button
          className="btn"
          type="button"
          disabled={saving}
          onClick={() => run(() => markInvoiceReturn(invoiceId, !isReturn))}
        >
          {isReturn ? "This is a bill, not a credit" : "Record as a credit"}
        </button>
        <button
          className="btn btn--quiet"
          type="button"
          disabled={saving}
          onClick={() => decide(quiet.to)}
        >
          {quiet.label}
        </button>
      </div>

      {error ? (
        <Note tight>
          {error === "forbidden"
            ? "This account cannot change an invoice's status."
            : `The decision did not save (${error}).`}
        </Note>
      ) : blocked ? (
        <Note tight>
          Approve unlocks when the gap is zero. These lines do not sum to the
          total the document prints, so posting them would put a figure into
          COGS that the invoice itself contradicts. Reject it, or record it as a
          credit, if that is what it is.
        </Note>
      ) : null}
    </>
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
              <ReviewDecision
                invoiceId={l.invoiceId}
                status={l.status}
                isReturn={l.isReturn}
                reconciles={l.reconciles}
              />
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
