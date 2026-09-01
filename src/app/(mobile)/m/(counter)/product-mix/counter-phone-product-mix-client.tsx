"use client"

import { useMemo } from "react"
import { Chart, MStrip, Section, useCounterTransition, SubNav } from "@/components/counter"
import { PHONE_MENU_TABS } from "@/lib/counter/nav"
import { readCounterParams } from "@/lib/counter/url-state"
import { rangeLabel } from "@/lib/counter/date-range"
import type { ProductMixSections } from "@/lib/counter/adapters/product-mix"
import type { SectionSources } from "@/lib/counter/adapters/types"

/**
 * Product mix, on a phone — `P.productmix.phone()`
 * (`docs/counter/counter-prototype.html:6295`): the title, a two-cell strip,
 * and units by item. That is the whole of it.
 *
 * The mix table and the margin bridge are both desk-only, which is where the
 * prototype stops. The bridge in particular should not come here: five lines
 * of arithmetic whose whole point is a caveat about the ORDER they are
 * computed in does not survive 390px, and a bridge shown without that caveat
 * reads as an accounting identity rather than one of six possible splits.
 *
 * `sections.table` is still handed to this surface and deliberately unused —
 * it is one query with the rest, so nothing is fetched for it, and the phone
 * choosing fewer sections than the desk is the pattern every other Counter
 * phone route follows.
 */
export function CounterPhoneProductMixClient({
  params: paramsString,
  today,
  sections,
}: {
  /** The query string as PLAIN TEXT — a `URLSearchParams` loses its prototype crossing the RSC boundary. */
  params: string
  today: Date
  sections: SectionSources<ProductMixSections>
}) {
  const params = useMemo(() => new URLSearchParams(paramsString), [paramsString])
  const counterParams = useMemo(() => readCounterParams(params, today), [params, today])

  const { pending } = useCounterTransition()
  const windowLabel = rangeLabel(counterParams.range, "custom")

  return (
    <>
      {/* The design's `VIEWS` bar, first inside `.mscroll` — which is exactly
          where `phoneFor()` puts a `.seg`. Same destinations as the desk's,
          on `/m` paths. */}
      <SubNav items={PHONE_MENU_TABS} label="Menu" />

      <div>
        <h2 className="mtitle">Product mix</h2>
        <p className="msub">{windowLabel}</p>
      </div>

      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <MStrip cells={h.phoneCells} />}
      </Section>

      <Section
        title="Units by item"
        meta={() => windowLabel}
        data={sections.units}
        pending={pending}
      >
        {(u) => <Chart {...u.phoneChart} />}
      </Section>

    </>
  )
}
