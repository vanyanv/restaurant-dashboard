"use client"

import { useCallback, useMemo } from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  Chart,
  DateControl,
  MathLines,
  PageHead,
  Section,
  Strip,
  Table,
  useCounterTransition,
  usePageChrome,
  type Column,
  type SwitchableStore,
} from "@/components/counter"
import { readCounterParams, writeCounterParams } from "@/lib/counter/url-state"
import { rangeLabel, stepRange } from "@/lib/counter/date-range"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { ProductMixSections } from "@/lib/counter/adapters/product-mix"

/**
 * Product mix, composed from `P.productmix.desk()`
 * (`docs/counter/counter-prototype.html:6266`): the strip, units by item, then
 * the split of the mix table and the margin bridge.
 *
 * The bridge is the only thing in the rebuild that answers "how much of the
 * margin change was the mix" — see the adapter, which also says why the order
 * of its lines is a choice rather than an identity.
 */
export type CounterProductMixSections = SectionSources<ProductMixSections>

const MIX_COLUMNS: Column[] = [
  { key: "item", label: "Item" },
  { key: "share", label: "Share", numeric: true },
  { key: "prior", label: "Prior", numeric: true },
  { key: "change", label: "Change", numeric: true },
  { key: "margin", label: "Margin", numeric: true },
]

const ASK_SUGGESTIONS = [
  "Which items gained share this period?",
  "How much of the margin change was the mix?",
  "How many items are in an average order?",
]

export function CounterProductMixClient({
  params: paramsString,
  stores,
  today,
  sections,
}: {
  params: string
  stores: SwitchableStore[]
  today: Date
  sections: CounterProductMixSections
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useMemo(() => new URLSearchParams(paramsString), [paramsString])
  const counterParams = useMemo(() => readCounterParams(params, today), [params, today])

  // `leaf` explicitly: Product mix has no rail entry of its own, so
  // `owningDestination` finds nothing and the trail would end at the store
  // with a bare separator after it.
  usePageChrome({ leaf: "Product mix", askSuggestions: ASK_SUGGESTIONS })

  const { pending, startTransition } = useCounterTransition()

  const push = useCallback(
    (next: Parameters<typeof writeCounterParams>[1]) => {
      const qs = writeCounterParams(params, next).toString()
      startTransition(() => {
        router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
      })
    },
    [params, pathname, router, startTransition],
  )

  const { range, presetId, comparisonId } = counterParams
  const storeName =
    stores.find((s) => s.id === counterParams.storeId)?.name ?? "All stores"
  const windowLabel = rangeLabel(range, "custom")

  return (
    <>
      <PageHead title="Product mix" sub={`${storeName} · ${windowLabel}`}>
        <DateControl
          presetId={presetId}
          comparisonId={comparisonId}
          range={range}
          onPreset={(id) => push({ presetId: id })}
          onComparison={(id) => push({ comparisonId: id })}
          onStep={(direction) => push({ range: stepRange(range, direction) })}
          onRange={(next) => push({ range: next })}
        />
      </PageHead>

      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <Strip cells={h.cells} />}
      </Section>

      {/* `sec(..., chart({...}), true)` — the fourth argument is ASK, and a
          chart body keeps its `.sec__body`. */}
      <Section
        title="Units by item"
        meta={(u) => u.meta}
        data={sections.units}
        pending={pending}
        askAbout
      >
        {(u) => <Chart {...u.chart} />}
      </Section>

      <div className="split">
        <Section
          title="Mix against last period"
          meta={(t) => t.meta}
          data={sections.table}
          pending={pending}
          // `tbl()` returns `raw()`, so a table section has no `.sec__body`.
          pad={false}
        >
          {(t) => <Table columns={MIX_COLUMNS} rows={t.rows} />}
        </Section>

        <Section
          title="What the mix cost you"
          meta={(b) => b.meta}
          data={sections.bridge}
          pending={pending}
          askAbout="how much of the margin change was the mix"
        >
          {(b) => (
            <>
              <MathLines rows={b.rows} />
              <p className="mono" style={{ margin: "10px 0 0" }}>
                {b.note}
              </p>
            </>
          )}
        </Section>
      </div>
    </>
  )
}
