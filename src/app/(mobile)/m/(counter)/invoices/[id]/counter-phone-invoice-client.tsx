"use client"

import Link from "next/link"
import { MList, MoneyLines, Section, useCounterTransition } from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { InvoiceSections } from "@/lib/counter/adapters/invoice"

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
            <p className="mono" style={{ margin: 0 }}>
              {d.note}
            </p>
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
          <MList
            rows={
              l.phoneRows.length > 0
                ? l.phoneRows
                : [{ key: "none", title: "Nothing needs a decision", detail: l.phoneEmpty, value: "—" }]
            }
          />
        )}
      </Section>

      <Section title="Totals" meta={() => ""} data={sections.lines} pending={pending}>
        {(l) => <MoneyLines rows={l.money} />}
      </Section>
    </>
  )
}
