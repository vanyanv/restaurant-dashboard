"use client"

import Link from "next/link"
import { MList, MStrip, Section, useCounterTransition } from "@/components/counter"
import type { InvoicesSections } from "@/lib/counter/adapters/invoices"
import type { SectionSources } from "@/lib/counter/adapters/types"

/**
 * Invoices, on a phone — `P.invoices.phone()`
 * (`docs/counter/counter-prototype.html:5698`): the title, a two-cell strip,
 * the review list, the settled list, and one button.
 *
 * The prototype's subtitle is "3 in review · 1 does not reconcile", which is
 * two counts of two different things and both are computed here. The desk's
 * spend chart, document panel and product table do not come to 390px — an
 * invoice on a phone is a decision to open something, not a report.
 *
 * The button goes to the queue's own first item rather than to a hardcoded
 * invoice, because the whole point of the phone surface is that the worst one
 * is one tap away.
 */
export function CounterPhoneInvoicesClient({
  sections,
}: {
  sections: SectionSources<InvoicesSections>
}) {
  const { pending } = useCounterTransition()

  return (
    <>
      <Section bare title="Invoices" data={sections.phoneQueues} pending={pending}>
        {(q) => (
          <div>
            <h2 className="mtitle">Invoices</h2>
            <p className="msub">{q.sub}</p>
          </div>
        )}
      </Section>

      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <MStrip cells={h.phoneCells} />}
      </Section>

      <Section title="Needs a look" meta={(q) => q.needsMeta} data={sections.phoneQueues} pending={pending}>
        {(q) => <MList rows={q.needsLook} />}
      </Section>

      <Section title="Settled" meta={(q) => q.settledMeta} data={sections.phoneQueues} pending={pending}>
        {(q) => <MList rows={q.settled} />}
      </Section>

      {/* The prototype's own last line is one button onto one invoice. It goes
          to the worst OPEN item rather than a hardcoded number — the whole
          argument for the phone surface is that the thing to look at is one
          tap away. */}
      <Section bare title="Go" data={sections.phoneQueues} pending={pending}>
        {(q) => (
          <Link className="mbtn mbtn--primary" href={q.firstHref}>
            Open the one that costs the most
          </Link>
        )}
      </Section>
    </>
  )
}
