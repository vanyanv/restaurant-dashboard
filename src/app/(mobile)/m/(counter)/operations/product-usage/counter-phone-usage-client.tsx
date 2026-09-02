"use client"

import { MList, MStrip, Section, useCounterTransition } from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { ProductUsageSections } from "@/lib/counter/adapters/product-usage"

/**
 * Product usage, on a phone — `P.usage.phone()`: the title, a two-cell strip
 * and the biggest gaps.
 *
 * The trend is desk-only. Its whole meaning is in a caveat — the two lines are
 * not meant to track day by day, because purchases land on delivery days and
 * theoretical accrues on selling days — and a chart whose reading depends on a
 * paragraph underneath it is the wrong thing to put on a phone.
 */
export function CounterPhoneUsageClient({
  sections,
}: {
  sections: SectionSources<ProductUsageSections>
}) {
  const { pending } = useCounterTransition()

  return (
    <>
      {/* The page's own NAME is a constant, so it is drawn in every state.
          Inside the section it was not: a failed headline left this phone
          page with no title at all, showing "Product usage unavailable" where
          its name belongs. Only the sub-line needs the data. Same rule the
          desk states on /dashboard/decisions — "the head is drawn in every
          state, including before that data exists". `Section bare` emits no
          DOM of its own, so the ready-state markup is unchanged. */}
      <div>
        <h2 className="mtitle">Product usage</h2>
        <Section bare title="Product usage" data={sections.headline} pending={pending}>
          {(h) => (
            <p className="msub">
              {h.cells[0].value} used · {h.cells[1].value} bought
            </p>
          )}
        </Section>
      </div>

      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <MStrip cells={h.phoneCells} />}
      </Section>

      <Section
        title="Biggest gaps"
        meta={(v) => v.meta}
        data={sections.variance}
        pending={pending}
      >
        {(v) => <MList rows={v.phoneRows} />}
      </Section>
    </>
  )
}
