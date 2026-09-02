"use client"

import Link from "next/link"
import { MList, MoneyLines, Note, Section, useCounterTransition } from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { InvoiceSections } from "@/lib/counter/adapters/invoice"
import { resolveInvoiceReview } from "@/lib/counter/actions/invoice"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

/**
 * One invoice, on a phone — `P.invoice.phone()`: the title, the alert block
 * when it does not tie out, the document, what needs a decision, and the
 * totals.
 *
 * The prototype's alert block is unconditional ("A line is missing"). Here it
 * is dropped entirely when the invoice reconciles — a red banner on a clean
 * record teaches a reader to ignore red banners.
 *
 * NO STRIP. `P.invoice.phone()` has none, and the two cells this page used to
 * put in one — what was extracted, and the gap — are already stated twice
 * over: in words by the `.mhead` above when there IS a gap, and as figures by
 * the Totals money-lines below, always. It was the same fact three times.
 *
 * "Needs a decision" and "Totals" are TWO sections, as the prototype composes
 * them. They were one, with the money-lines tacked onto the end of the
 * decision list — which reads as "these totals belong to these lines" rather
 * than "here is the document's arithmetic", and cost the page a section.
 */

/**
 * APPROVING AN INVOICE FROM THE PHONE.
 *
 * This page draws a section titled "Needs a decision" and, until now, could not
 * take one. `e2e/fidelity/manifest.ts` declared two `.mbtn` absent here —
 * "Approve" and "Add the line" — and said of the first that approving "posts an
 * invoice to COGS through an API that exists but is deliberately not wired to a
 * button yet". It is wired now, on the desk and here, so that allowance drops
 * from two to one.
 *
 * ONE BUTTON, WHICH IS WHAT THE FIXTURE DRAWS. `P.invoice.phone()` offers
 * Approve and "Add the line"; the second would create an `InvoiceLineItem` by
 * hand and nothing does, so it stays declared. The desk's three-slot control —
 * approve, credit, reject — is a desk shape: this surface is for the one
 * decision someone makes while looking at a document on their phone, and
 * anything more is a form.
 *
 * THE SAME GATE AS THE DESK. Approve is disabled exactly while the extracted
 * lines fail to sum to the printed total, because approving posts to COGS and
 * an invoice that contradicts itself must not go in. The note says why rather
 * than leaving a dead control.
 */
function PhoneReviewDecision({
  invoiceId,
  status,
  reconciles,
}: {
  invoiceId: string
  status: string
  reconciles: boolean
}) {
  const router = useRouter()
  const [saving, startSaving] = useTransition()
  const [said, setSaid] = useState<string | null>(null)

  const approved = status === "APPROVED"
  const blocked = !approved && !reconciles

  const decide = () => {
    setSaid(null)
    startSaving(async () => {
      const result = await resolveInvoiceReview(invoiceId, approved ? "REVIEW" : "APPROVED")
      if (!result.ok) {
        setSaid("That did not save.")
        return
      }
      router.refresh()
    })
  }

  return (
    <>
      <button
        className="mbtn mbtn--primary"
        type="button"
        disabled={saving || blocked}
        onClick={decide}
      >
        {saving ? "Saving…" : approved ? "Reopen the review" : "Approve and post"}
      </button>
      <Note tight>
        {said ??
          (blocked
            ? "Approve unlocks when the gap is zero. These lines do not sum to the total the document prints."
            : approved
              ? "Posted to COGS. Reopening puts it back in the queue."
              : "Approving posts this invoice to COGS.")}
      </Note>
    </>
  )
}

export function CounterPhoneInvoiceClient({
  title,
  vendor,
  sections,
}: {
  title: string
  vendor: string
  sections: SectionSources<InvoiceSections>
}) {
  const { pending } = useCounterTransition()

  return (
    <>
      <Section bare title="Invoice" data={sections.head} pending={pending}>
        {(h) => (
          <>
            <div>
              <h2 className="mtitle">{title}</h2>
              <p className="msub">{vendor}</p>
            </div>
            {h.alert ? (
              <div
                className="mhead"
                style={{ borderColor: "var(--bad)", background: "var(--bad-wash)" }}
              >
                <span className="k" style={{ color: "var(--bad)" }}>
                  {h.alert.label}
                </span>
                <span className="v">{h.alert.value}</span>
                <p>{h.alert.body}</p>
              </div>
            ) : null}
          </>
        )}
      </Section>

      <Section
        title="The document"
        meta={(d) => d.meta}
        data={sections.document}
        pending={pending}
      >
        {(d) =>
          d.href ? (
            <Link className="mbtn" href={d.href} target="_blank" rel="noreferrer">
              Open the PDF
            </Link>
          ) : (
            <Note bare>
              {d.note}
            </Note>
          )
        }
      </Section>

      <Section
        title="Needs a decision"
        meta={(l) => l.phoneMeta}
        data={sections.lines}
        pending={pending}
      >
        {/* Always an `.mlist`, which is what `P.invoice.phone()` draws here.
            A paragraph in its place left the panel as a heading with prose
            under it — and when there is nothing to decide, ONE row saying so
            is the list, not the absence of one. */}
        {(l) => (
          <>
            <MList
              rows={
                l.phoneRows.length > 0
                  ? l.phoneRows
                  : [{ key: "none", title: "Nothing needs a decision", detail: l.phoneEmpty, value: "—" }]
              }
            />
          </>
        )}
      </Section>

      <Section title="Totals" meta={() => ""} data={sections.lines} pending={pending}>
        {(l) => (
          <>
            <MoneyLines rows={l.money} />
            {/* `P.invoice.phone()` closes on a `.mbtnrow` AFTER the totals,
                not inside "Needs a decision" — the decision follows the
                arithmetic it is a decision about, which is the same argument
                the desk page's own control makes. The gate caught the first
                placement: same landmark, six positions early. */}
            <div className="mbtnrow">
              <PhoneReviewDecision
                invoiceId={l.invoiceId}
                status={l.status}
                reconciles={l.reconciles}
              />
            </div>
          </>
        )}
      </Section>
    </>
  )
}
