"use client"

import { MList, MStrip, Section, useCounterTransition } from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { VendorSections } from "@/lib/counter/adapters/vendor"

/**
 * One vendor, on a phone — `P.vendor.phone()`: the title, a two-cell strip and
 * the invoices.
 *
 * The basket comparison is desk-only. It carries a caveat that needs reading —
 * a per-unit gap can be a bigger case rather than a worse deal — and a table
 * whose whole meaning lives in a paragraph under it is the wrong thing to put
 * on a phone.
 */
export function CounterPhoneVendorClient({
  title,
  sections,
}: {
  title: string
  sections: SectionSources<VendorSections>
}) {
  const { pending } = useCounterTransition()

  return (
    <>
      <Section bare title="Vendor" data={sections.head} pending={pending}>
        {(h) => (
          <div>
            <h2 className="mtitle">{title}</h2>
            <p className="msub">{h.sub}</p>
          </div>
        )}
      </Section>

      <Section bare title="The figures" data={sections.head} pending={pending}>
        {(h) => <MStrip cells={h.phoneCells} />}
      </Section>

      <Section title="Invoices" meta={(i) => i.phoneMeta} data={sections.invoices} pending={pending}>
        {(i) => <MList rows={i.phoneRows} />}
      </Section>
    </>
  )
}
