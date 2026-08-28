"use client"

import { useMemo } from "react"
import {
  Chart,
  MList,
  MStrip,
  Section,
  useCounterTransition,
  usePageChrome,
  type SwitchableStore,
} from "@/components/counter"
import { readCounterParams } from "@/lib/counter/url-state"
import { rangeLabel } from "@/lib/counter/date-range"
import { pct } from "@/lib/counter/format"
import type { StoreCogsSections } from "@/lib/counter/adapters/cogs"
import type { SectionSources } from "@/lib/counter/adapters/types"

/**
 * One store's COGS, on a phone — `P.cogsstore.phone()`
 * (`docs/counter/counter-prototype.html:7780`).
 *
 * Three sections: the strip, the plan chart against this store's own target,
 * and what moved. The desk route's worst-margin table is not here, the same
 * way the group phone page carries neither the category ring nor the item
 * table — a four-column table of items and points is not readable at 340px,
 * and the prototype's own phone composition stops before it.
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

      <Section
        title="What moved"
        meta={(m) => m.meta}
        data={sections.moved}
        pending={pending}
      >
        {(m) => <MList rows={m.phoneRows} />}
      </Section>
    </>
  )
}
