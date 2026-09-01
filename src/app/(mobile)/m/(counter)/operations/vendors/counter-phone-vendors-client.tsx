"use client"

import { MList, MStrip, Section, useCounterTransition, SubNav } from "@/components/counter"
import { PHONE_VENDOR_TABS } from "@/lib/counter/nav"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { VendorsSections } from "@/lib/counter/adapters/vendors"

/**
 * Vendors, on a phone — `P.vendors.phone()`: the title, a two-cell strip and a
 * list by spend.
 *
 * NO PRICE TREND, and it used to have one. The design puts the trend on the
 * desk and not here, which is the same call this project already made for
 * itself: the phone is a glance-and-do surface, and a basket index over eight
 * weeks is analysis. Removing it costs the product nothing — the desk vendors
 * page renders the identical chart from the identical `trend` section — and a
 * phone reader keeps the two figures and the ranked list, which are the parts
 * you can act on standing up.
 *
 * The prototype's second phone cell is `On time · 92%`. Nothing in this schema
 * records a promised delivery date, so it is replaced by the reconciliation
 * count — which is the other thing a phone reader can act on and the one this
 * account actually has an answer for.
 */
export function CounterPhoneVendorsClient({
  sections,
}: {
  sections: SectionSources<VendorsSections>
}) {
  const { pending } = useCounterTransition()

  return (
    <>
      {/* The design's `VIEWS` bar, first inside `.mscroll` — which is exactly
          where `phoneFor()` puts a `.seg`. Same destinations as the desk's,
          on `/m` paths. */}
      <SubNav items={PHONE_VENDOR_TABS} label="Vendors" />

      <Section bare title="Vendors" data={sections.headline} pending={pending}>
        {(h) => (
          <div>
            <h2 className="mtitle">Vendors</h2>
            <p className="msub">
              {h.cells[0].value} · {h.cells[0].delta}
            </p>
          </div>
        )}
      </Section>

      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <MStrip cells={h.phoneCells} />}
      </Section>


      <Section title="By spend" meta={(l) => l.meta} data={sections.list} pending={pending}>
        {(l) => <MList rows={l.rows} />}
      </Section>
    </>
  )
}
