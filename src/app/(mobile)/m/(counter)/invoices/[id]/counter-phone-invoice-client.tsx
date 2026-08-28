"use client"

import Link from "next/link"
import { MList, MoneyLines, MStrip, Section, useCounterTransition } from "@/components/counter"
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

      <Section bare title="The figures" data={sections.head} pending={pending}>
        {(h) => <MStrip cells={h.phoneCells} />}
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
        {(l) => (
          <>
            {l.phoneRows.length > 0 ? (
              <MList rows={l.phoneRows} />
            ) : (
              <p className="mono" style={{ margin: "0 0 11px" }}>
                {l.phoneEmpty}
              </p>
            )}
            <MoneyLines rows={l.money} />
          </>
        )}
      </Section>
    </>
  )
}
