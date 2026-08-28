"use client"

import Link from "next/link"
import { useMemo } from "react"
import { MList, MStrip, Section, useCounterTransition } from "@/components/counter"
import { readCounterParams } from "@/lib/counter/url-state"
import { rangeLabel } from "@/lib/counter/date-range"
import type { MenuCatalogSections } from "@/lib/counter/adapters/menu-catalog"
import type { SectionSources } from "@/lib/counter/adapters/types"

/**
 * The menu catalog, on a phone — `P.catalog.phone()`
 * (`docs/counter/counter-prototype.html:6090`).
 *
 * The strip, the unmapped list, the top sellers, and one primary button, which
 * is where the prototype stops. The table, the filters and the category ring
 * are desk-only: a seven-column table does not survive 390px, and the ring's
 * whole value here is the four-line note explaining why not to trust it.
 *
 * ## "Unmapped" means MODIFIERS on this menu
 *
 * The prototype's list is unmapped items. Measured, those are seven POS
 * open-item rows worth sixty-two dollars in total. The gap that matters is
 * modifiers — Add Pickles sold 2,250 times at $0, so it earns nothing, shows
 * up in nothing ranked by revenue, and still costs food. The adapter ranks
 * them by servings for that reason and this list shows them.
 */
export function CounterPhoneCatalogClient({
  params: paramsString,
  today,
  sections,
}: {
  /** The query string as PLAIN TEXT — a `URLSearchParams` loses its prototype crossing the RSC boundary. */
  params: string
  today: Date
  sections: SectionSources<MenuCatalogSections>
}) {
  const params = useMemo(() => new URLSearchParams(paramsString), [paramsString])
  const counterParams = useMemo(() => readCounterParams(params, today), [params, today])

  const { pending } = useCounterTransition()
  const windowLabel = rangeLabel(counterParams.range, "custom")

  return (
    <>
      <div>
        <h2 className="mtitle">Menu catalog</h2>
        <p className="msub">{windowLabel}</p>
      </div>

      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <MStrip cells={h.phoneCells} />}
      </Section>

      <Section
        title="Unmapped"
        meta={(l) => `${l.unmappedModifiers} modifiers`}
        data={sections.list}
        pending={pending}
      >
        {(l) => <MList rows={l.phoneUnmapped} />}
      </Section>

      <Section
        title="Top sellers"
        meta={() => windowLabel}
        data={sections.list}
        pending={pending}
      >
        {(l) => <MList rows={l.phoneTop} />}
      </Section>

      {/* `.mbtn` is class-keyed and styles an `<a>` unchanged — a destination
          is a link, not a button, the same trade the decisions phone page made. */}
      <Link className="mbtn mbtn--primary" href="/dashboard/recipes">
        Map the modifiers
      </Link>
    </>
  )
}
