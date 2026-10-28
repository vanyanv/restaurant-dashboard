"use client"

import Link from "next/link"
import {
  Kv,
  MoneyLines,
  Note,
  PageHead,
  Section,
  Table,
  useCounterTransition,
  usePageChrome,
  type Column,
  type SwitchableStore,
} from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { InvoiceCheck, InvoiceLines, InvoiceSections } from "@/lib/counter/adapters/invoice"
import { markInvoiceReturn, resolveInvoiceReview } from "@/lib/counter/actions/invoice"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { InvoiceGlyph, Tiles, type InvoiceGlyphKind } from "../invoices-ui"

/**
 * One invoice, laid out the way Store checks lays out a check: the verdict
 * and its one next step on top, then the document beside "What we checked",
 * then the lines with the arithmetic under them, then where it came from.
 *
 * The adapter's docblock argues the central departure from the prototype:
 * **nothing in this schema records how many lines the document had.** The
 * printed subtotal is the only evidence a line went missing, so the gap is
 * stated against that — and "What we checked" is computed from the same gap
 * the money lines print, so the two cannot disagree.
 *
 * No `DateControl`: an invoice is a record, and a date range cannot narrow one.
 */
export type CounterInvoiceSections = SectionSources<InvoiceSections>

const LINE_COLUMNS: Column[] = [
  { key: "n", label: "#", numeric: true },
  { key: "product", label: "As printed" },
  { key: "qty", label: "Qty", numeric: true },
  { key: "price", label: "Unit", numeric: true },
  { key: "ext", label: "Extended", numeric: true },
  { key: "matched", label: "Goes to ingredient" },
]

const ASK_SUGGESTIONS = [
  "Why is this invoice in review?",
  "Which lines match nothing in the catalogue?",
  "Does this invoice tie out?",
]

const CHECK_GLYPH: Record<InvoiceCheck["tone"], InvoiceGlyphKind> = {
  good: "ok",
  bad: "miss",
  warn: "open",
}

const STATUS_PILL: Record<string, { word: string; cls: string }> = {
  REVIEW: { word: "In review", cls: "iv-pill--warn" },
  APPROVED: { word: "Approved", cls: "iv-pill--good" },
  MATCHED: { word: "Matched", cls: "iv-pill--good" },
  REJECTED: { word: "Rejected", cls: "" },
  PENDING: { word: "No store matched", cls: "iv-pill--warn" },
}

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
      <div className="btnrow">
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
          Approve unlocks when the gap is under a dollar. These lines do not sum to the
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
      <nav className="iv-crumb" aria-label="Breadcrumb">
        <Link href="/dashboard/invoices">Invoices</Link> / {vendor} · {title}
      </nav>

      <PageHead title={`${vendor} · ${title}`} sub="One invoice, checked against its own PDF" />

      <Section bare title="The figures" data={sections.head} pending={pending}>
        {(h) => (
          <div className="iv-head">
            <p className="iv-sub">{h.sub}</p>
            <Tiles cells={h.cells} />
          </div>
        )}
      </Section>

      <Section bare title="Decision" data={sections.lines} pending={pending}>
        {(l) => <DecisionBar lines={l} />}
      </Section>

      <div className="split">
        <Section title="The invoice" meta={(d) => d.meta} data={sections.document} pending={pending}>
          {(d) => (
            <>
              {d.href ? (
                <object className="docpane" data={d.href} type="application/pdf" aria-label="The stored invoice PDF">
                  <a href={d.href} target="_blank" rel="noreferrer">
                    Open the PDF
                  </a>
                </object>
              ) : null}
              {d.href ? (
                <p className="iv-open">
                  <a href={d.href} target="_blank" rel="noreferrer">
                    Open the full PDF
                  </a>
                </p>
              ) : null}
              <Note bare={!d.href}>{d.note}</Note>
            </>
          )}
        </Section>

        <Section
          title="What we checked"
          meta={(r) => r.meta}
          data={sections.reasons}
          pending={pending}
          pad={false}
          askAbout="why is this invoice in review"
        >
          {(r) => (
            <>
              <ul className="iv-checks">
                {r.checks.map((c) => (
                  <li key={c.key} className={`iv-check iv-check--${c.tone}`}>
                    <InvoiceGlyph kind={CHECK_GLYPH[c.tone]} />
                    <span>
                      <b>{c.title}</b>
                      <span className="ck-meta">{c.body}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <Note flush>{r.note}</Note>
            </>
          )}
        </Section>
      </div>

      <Section
        title="Lines"
        meta={(l) => l.meta}
        data={sections.lines}
        pending={pending}
        askAbout="which lines match nothing in the catalogue"
      >
        {(l) => (
          <>
            <Table columns={LINE_COLUMNS} rows={l.rows} />
            <div className="sec__body">
              <MoneyLines rows={l.money} />
              <Note>{l.note}</Note>
            </div>
          </>
        )}
      </Section>

      <Section title="How it got here" meta={(p) => p.arrival.meta} data={sections.panels} pending={pending}>
        {(p) => (
          <div className="iv-panels">
            <div>
              <span className="ck-mono">Arrival</span>
              <Kv rows={p.arrival.rows} />
            </div>
            <div>
              <span className="ck-mono">What we store · {p.storage.meta}</span>
              <Kv rows={p.storage.rows} />
            </div>
            <div>
              <span className="ck-mono">Matching · {p.matching.meta}</span>
              <Kv rows={p.matching.rows} />
              <Note tight>{p.matching.note}</Note>
            </div>
          </div>
        )}
      </Section>
    </>
  )
}

/** The verdict and its buttons, above everything they are a verdict on. */
function DecisionBar({ lines }: { lines: InvoiceLines }) {
  const pill = STATUS_PILL[lines.status] ?? { word: lines.status, cls: "" }
  return (
    <div className={`iv-decide${lines.reconciles ? "" : " iv-decide--bad"}`}>
      <div className="iv-decide__state">
        <span className={`iv-pill ${pill.cls}`}>{pill.word}</span>
        {lines.isReturn ? <span className="iv-pill">Credit memo</span> : null}
        {lines.reconciles ? (
          <span className="iv-pill iv-pill--good">Ties out</span>
        ) : (
          <span className="iv-pill iv-pill--bad">Does not add up</span>
        )}
      </div>
      <ReviewDecision
        invoiceId={lines.invoiceId}
        status={lines.status}
        isReturn={lines.isReturn}
        reconciles={lines.reconciles}
      />
    </div>
  )
}
