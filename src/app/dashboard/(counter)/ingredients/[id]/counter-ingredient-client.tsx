"use client"

import { useCallback, useMemo } from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  Chart,
  DateControl,
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
import { stepRange } from "@/lib/counter/date-range"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { IngredientSections } from "@/lib/counter/adapters/ingredient"

/**
 * One ingredient, composed from `P.ingredient.desk()`
 * (`docs/counter/counter-prototype.html:7024`) in the prototype's own order:
 *
 *   strip -> price history -> a split of matched SKUs and used-in.
 *
 * The adapter's docblock argues the departures. Two of the five strip cells
 * and one table column describe data this account does not have — there is no
 * on-hand figure for anything, and `IngredientSkuMatch` has no confidence
 * column — and the prototype's whole narrative is an ingredient getting more
 * expensive, where this one got cheaper.
 */
export type CounterIngredientSections = SectionSources<IngredientSections>

const SKU_COLUMNS: Column[] = [
  { key: "vendor", label: "Vendor" },
  { key: "product", label: "Billed as" },
  { key: "pack", label: "Pack" },
  { key: "conversion", label: "Conversion" },
  { key: "price", label: "Last price", numeric: true },
  { key: "lines", label: "Lines", numeric: true },
]

const USED_COLUMNS: Column[] = [
  { key: "recipe", label: "Recipe" },
  { key: "qty", label: "Qty", numeric: true },
  { key: "cost", label: "Line cost", numeric: true },
  { key: "sold", label: "Sold", numeric: true },
  { key: "move", label: "Cost of the move", numeric: true },
]

const ASK_SUGGESTIONS = [
  "How has this ingredient's price moved?",
  "Which recipes use this ingredient?",
  "Which vendors bill against it?",
]

export function CounterIngredientClient({
  params: paramsString,
  stores,
  today,
  title,
  sections,
}: {
  params: string
  stores: SwitchableStore[]
  today: Date
  title: string
  sections: CounterIngredientSections
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useMemo(() => new URLSearchParams(paramsString), [paramsString])
  const counterParams = useMemo(() => readCounterParams(params, today), [params, today])

  // The breadcrumb names the RECORD. The title is a prop rather than a read
  // off `sections.head`, because reading a section here would mean awaiting
  // the loader — see `getIngredientName`.
  usePageChrome({ leaf: title, askSuggestions: ASK_SUGGESTIONS })

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
  const storeName = stores.find((s) => s.id === counterParams.storeId)?.name ?? "All stores"

  return (
    <>
      <PageHead title={title} sub={storeName}>
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

      <Section bare title="The figures" data={sections.head} pending={pending}>
        {(h) => (
          <>
            {/* Recipe unit and category. These belong under the title and
                cannot go there: the masthead renders before the loader
                resolves. */}
            <p className="mono" style={{ margin: "0 0 11px" }}>
              {h.sub}
            </p>
            <Strip cells={h.cells} />
          </>
        )}
      </Section>

      <Section
        title="Price history"
        meta={(p) => p.meta}
        data={sections.prices}
        pending={pending}
        askAbout="how has this ingredient's price moved"
      >
        {(p) => (
          <>
            <Chart {...p.chart} fmt={PRICE} />
            <p className="mono" style={{ margin: "9px 0 0" }}>
              {p.note}
            </p>
          </>
        )}
      </Section>

      <div className="split">
        <Section
          title="Matched SKUs"
          meta={(s) => s.meta}
          data={sections.skus}
          pending={pending}
          pad={false}
        >
          {(s) => (
            <>
              <Table columns={SKU_COLUMNS} rows={s.rows} />
              {/* No `.sec__body` — a table section emits the table alone, so
                  the note carries the body's own inset inline. */}
              <p className="mono" style={{ margin: 0, padding: "13px 15px" }}>
                {s.note}
              </p>
            </>
          )}
        </Section>

        <Section
          title="Used in"
          meta={(u) => u.meta}
          data={sections.usedIn}
          pending={pending}
          pad={false}
          askAbout="which recipes use this ingredient"
        >
          {(u) => (
            <>
              <Table columns={USED_COLUMNS} rows={u.rows} />
              <p className="mono" style={{ margin: 0, padding: "13px 15px" }}>
                {u.note}
              </p>
            </>
          )}
        </Section>
      </div>
    </>
  )
}

/** Dollars, to the cent — a unit price, not a total. */
const PRICE = (v: number) => `$${v.toFixed(2)}`
