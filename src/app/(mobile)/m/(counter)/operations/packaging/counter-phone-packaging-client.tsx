"use client"

import { MList, MStrip, Note, Section, SubNav, useCounterTransition } from "@/components/counter"
import { PHONE_VENDOR_TABS } from "@/lib/counter/nav"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { PackagingSections } from "@/lib/counter/adapters/packaging"

/**
 * Packaging, on a phone — `P.packaging.phone()`: the title, a two-cell strip
 * and the containers.
 *
 * The phone's strip carries the per-order cost and whether the invoices agree,
 * rather than the prototype's spend and share of COGS. Spend is a number to
 * read at a desk; whether the model can be trusted is what decides if the
 * number below it means anything.
 */
export function CounterPhonePackagingClient({
  sections,
}: {
  sections: SectionSources<PackagingSections>
}) {
  const { pending } = useCounterTransition()

  return (
    <>
      {/* The design's `VIEWS` bar, first inside `.mscroll` — which is exactly
          where `phoneFor()` puts a `.seg`. Same destinations as the desk's,
          on `/m` paths. */}
      <SubNav items={PHONE_VENDOR_TABS} label="Vendors" />

      {/* The page's own NAME is a constant, so it is drawn in every state.
          Inside the section it was not: a failed headline left this phone
          page with no title at all, showing "Packaging unavailable" where
          its name belongs. Only the sub-line needs the data. Same rule the
          desk states on /dashboard/decisions — "the head is drawn in every
          state, including before that data exists". `Section bare` emits no
          DOM of its own, so the ready-state markup is unchanged. */}
      <div>
        <h2 className="mtitle">Packaging</h2>
        <Section bare title="Packaging" data={sections.headline} pending={pending}>
          {(h) => (
            <p className="msub">
              {h.cells[1].value} an order · {h.cells[0].value} in all
            </p>
          )}
        </Section>
      </div>

      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <MStrip cells={h.phoneCells} />}
      </Section>

      <Section title="Containers" meta={(l) => l.meta} data={sections.ledger} pending={pending}>
        {(l) => (
          <>
            <MList rows={l.phoneRows} />
            <Note>
              {l.note}
            </Note>
          </>
        )}
      </Section>
    </>
  )
}
