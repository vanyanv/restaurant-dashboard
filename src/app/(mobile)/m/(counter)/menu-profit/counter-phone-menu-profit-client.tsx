"use client"

import { useMemo } from "react"
import { Chart, MList, MStrip, Section, useCounterTransition, SubNav } from "@/components/counter"
import { PHONE_MENU_TABS } from "@/lib/counter/nav"
import { readCounterParams } from "@/lib/counter/url-state"
import { rangeLabel } from "@/lib/counter/date-range"
import type { MenuProfitSections } from "@/lib/counter/adapters/menu-profit"
import type { SectionSources } from "@/lib/counter/adapters/types"

/**
 * Menu profit, on a phone — `P.menu.phone()`
 * (`docs/counter/counter-prototype.html:5507`).
 *
 * Three sections, which is where the prototype stops: the two-cell strip,
 * profit by item as bars, and the four groups as a list.
 *
 * ## The scatter does not come to the phone, and the groups are why
 *
 * A fifty-one-dot matrix with a filtering legend is not a reading at 340px.
 * But the four quadrants ARE the point of that section, so it degrades into
 * them rather than being dropped — `matrix.phoneRows` is the same section's
 * own data, counted.
 *
 * The honesty section is desk-only. Its argument needs four lines of prose to
 * make (that "99.8% costed" is the reassuring figure and "89.9% fully costed"
 * is the true one), and a phone row that showed the number without the
 * argument would leave the reader with the reassuring half.
 */
export function CounterPhoneMenuProfitClient({
  params: paramsString,
  today,
  sections,
}: {
  /** The query string as PLAIN TEXT — a `URLSearchParams` loses its prototype crossing the RSC boundary. */
  params: string
  today: Date
  sections: SectionSources<MenuProfitSections>
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
        <h2 className="mtitle">Menu profit</h2>
        <p className="msub">{windowLabel}</p>
      </div>

      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <MStrip cells={h.phoneCells} />}
      </Section>

      <Section
        title="Profit by item"
        meta={() => windowLabel}
        data={sections.ledger}
        pending={pending}
      >
        {(l) => <Chart {...l.phoneChart} />}
      </Section>

      <Section
        title="The four groups"
        meta={() => "menu engineering"}
        data={sections.matrix}
        pending={pending}
      >
        {(m) => <MList rows={m.phoneRows} />}
      </Section>
    </>
  )
}
