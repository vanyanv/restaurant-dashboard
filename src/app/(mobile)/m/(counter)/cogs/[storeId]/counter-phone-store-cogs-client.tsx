"use client"

import { useMemo } from "react"
import {
  Chart,
  MStrip,
  Section,
  useCounterTransition,
  usePageChrome,
  type SwitchableStore,
  SubNav,
} from "@/components/counter"
import { storeViewTabs } from "@/lib/counter/nav"
import { readCounterParams } from "@/lib/counter/url-state"
import { rangeLabel } from "@/lib/counter/date-range"
import { pct } from "@/lib/counter/format"
import type { StoreCogsSections } from "@/lib/counter/adapters/cogs"
import type { SectionSources } from "@/lib/counter/adapters/types"

/**
 * One store's COGS, on a phone — `P.cogsstore.phone()`
 * (`docs/counter/counter-prototype.html:7780`).
 *
 * TWO sections: the strip and the plan chart against this store's own target.
 * That is where `P.cogsstore.phone()` stops — mtitle, msub, `mstrip`, one
 * `sec`, and nothing after it.
 *
 * The first cut of this file carried "What moved" as a third section, copied
 * from the group phone page's shape rather than read off this page's own
 * prototype. The fidelity gate measured it immediately: **prototype 5
 * landmarks, ours 9** — a `.sec`, its head, its body and an `.mlist`, four
 * EXTRA, and an extra is never forgiven (ruling F-R8). The desk route keeps
 * the movement table; this surface does not, the same way the group phone
 * page carries neither the category ring nor the item table.
 *
 * ## Everything shown is the adapter's own phone payload
 *
 * `phoneCells`, `phoneChart` and `phoneRows` are built in
 * `adapters/cogs.ts` beside the desk's arrays, so the two surfaces cannot
 * format one figure two ways — and this island slices nothing. A page
 * slicing `cells` by position gets the wrong cell the moment one is withheld,
 * which is exactly what happens here: the store strip is four cells on the
 * desk and two on the phone, and they are not the same two.
 */
const PCT = (v: number) => pct(v, { scaled: true })

export function CounterPhoneStoreCogsClient({
  params: paramsString,
  storeId,
  stores,
  today,
  sections,
}: {
  /** The query string as PLAIN TEXT — a `URLSearchParams` loses its prototype crossing the RSC boundary. */
  params: string
  storeId: string
  stores: SwitchableStore[]
  today: Date
  sections: SectionSources<StoreCogsSections>
}) {
  const params = useMemo(() => new URLSearchParams(paramsString), [paramsString])
  const counterParams = useMemo(() => readCounterParams(params, today), [params, today])

  // The PATH's store — `page.tsx` reconciled `?store=` before this rendered.
  const storeName = stores.find((s) => s.id === storeId)?.name ?? "This store"

  // `PhoneShell`'s `.mtop` reads the selected store from `?store=`, and this
  // route carries none, so without this it would show "All stores" above a
  // page about one — the same gap the desk sibling has.
  usePageChrome({ leaf: storeName, storeId, storeName })

  /*
   * This page owns no `push` — the date sheet and the store picker are
   * `PhoneShell`'s. `pending` is that same transition, threaded to every
   * `<Section>` so a store or range change reads as `stale` rather than a
   * blank `loading.tsx`.
   */
  const { pending } = useCounterTransition()

  const { range } = counterParams
  const windowLabel = rangeLabel(range, "custom")

  return (
    <>
      {/* `VIEWS`'s group/store pair, first inside `.mscroll`. "One store"
          appears only once a store is picked — the design's own sequence. */}
      <SubNav items={storeViewTabs("/m/cogs", storeId, paramsString, [{ label: "Theoretical vs actual", href: "/m/operations/product-usage" }], "Cost")} label="COGS" />

      <div>
        <h2 className="mtitle">{storeName}</h2>
        <p className="msub">{windowLabel}</p>
      </div>

      {/* `h.phoneCells` — two, and NOT a slice of the desk's four. */}
      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <MStrip cells={h.phoneCells} />}
      </Section>

      {/* The adapter's own shorter, tickless chart. No sentence and no note:
          at 340px there is no room for the desk's prose beside its own chart,
          and the prototype's phone composition stops at the chart too. */}
      <Section
        title="Against this store's target"
        meta={(p) => p.meta}
        data={sections.plan}
        pending={pending}
      >
        {(p) => <Chart {...p.phoneChart} fmt={PCT} />}
      </Section>
    </>
  )
}
