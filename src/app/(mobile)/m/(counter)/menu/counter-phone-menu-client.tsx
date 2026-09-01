"use client"

import { useMemo } from "react"
import { MList, MStrip, Section, useCounterTransition, SubNav } from "@/components/counter"
import { PHONE_MENU_TABS } from "@/lib/counter/nav"
import { readCounterParams } from "@/lib/counter/url-state"
import { rangeLabel } from "@/lib/counter/date-range"
import type { MenuHubSections } from "@/lib/counter/adapters/menu-hub"
import type { SectionSources } from "@/lib/counter/adapters/types"

/**
 * The Menu hub, on a phone.
 *
 * Two sections — the strip and the three destinations — which is where
 * `P.menuhub.phone()` stops. The category ring is desk-only: six slices and a
 * legend is not a reading at 340px, and the desk page's own note about
 * placements versus items needs four lines to say.
 *
 * `h.phoneCells` is TWO and is not a slice of the desk's four: the phone shows
 * the two cells that need acting on — the margin and the unmapped count — and
 * a page slicing by position gets the wrong pair the moment one is withheld.
 */
export function CounterPhoneMenuClient({
  params: paramsString,
  today,
  sections,
}: {
  /** The query string as PLAIN TEXT — a `URLSearchParams` loses its prototype crossing the RSC boundary. */
  params: string
  today: Date
  sections: SectionSources<MenuHubSections>
}) {
  const params = useMemo(() => new URLSearchParams(paramsString), [paramsString])
  const counterParams = useMemo(() => readCounterParams(params, today), [params, today])

  // The date sheet and the store picker are `PhoneShell`'s; `pending` is that
  // same transition, so a change reads as `stale` rather than a blank boundary.
  const { pending } = useCounterTransition()

  // The window's own ENDS, never a preset's name — the convention every other
  // Counter route's `windowLabel` follows.
  //
  // NOT the adapter's `headline.sub` ("61 items · 7 unmapped"), which is what
  // the prototype writes here. That string depends on the counts, so a title
  // built from it does not exist until they load — the page would render its
  // loading boundary with no heading at all and then grow one. The counts are
  // in the strip immediately below, one line later, where their absence is a
  // skeleton rather than a hole.
  const windowLabel = rangeLabel(counterParams.range, "custom")

  return (
    <>
      {/* The design's `VIEWS` bar, first inside `.mscroll` — which is exactly
          where `phoneFor()` puts a `.seg`. Same destinations as the desk's,
          on `/m` paths. */}
      <SubNav items={PHONE_MENU_TABS} label="Menu" />

      <div>
        <h2 className="mtitle">Menu</h2>
        <p className="msub">{windowLabel}</p>
      </div>

      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <MStrip cells={h.phoneCells} />}
      </Section>

      <Section title="Where to work" data={sections.work} pending={pending}>
        {(w) => <MList rows={w.phoneRows} />}
      </Section>
    </>
  )
}
