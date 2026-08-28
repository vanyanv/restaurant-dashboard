"use client"

import { useCallback, useMemo } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  Chart,
  DateControl,
  PageHead,
  Queue,
  RowLine,
  Section,
  Strip,
  Table,
  Tag,
  useCounterTransition,
  usePageChrome,
  type Column,
  type SwitchableStore,
} from "@/components/counter"
import { readCounterParams, writeCounterParams } from "@/lib/counter/url-state"
import { stepRange } from "@/lib/counter/date-range"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { IngredientsSections } from "@/lib/counter/adapters/ingredients"

/**
 * Ingredients, composed from `P.ingredients.desk()`
 * (`docs/counter/counter-prototype.html:5772`) in the prototype's own order:
 *
 *   strip → the price monitor → a split of catalogue, review inbox and
 *   modifier mapping → a split of the worklist and the pantry.
 *
 * The adapter's docblock argues the three sections whose subject changed —
 * the frozen catalogue, an inbox with no pending proposals in it, and a
 * "needs review" queue whose real content is 43 ingredients in no recipe
 * rather than 24 unmatched lines. This file renders what it is handed and
 * prints each reason under the section it belongs to.
 */
export type CounterIngredientsSections = SectionSources<IngredientsSections>

const CATALOGUE_COLUMNS: Column[] = [
  { key: "item", label: "Ingredient" },
  { key: "vendors", label: "Vendors", numeric: true },
  { key: "price", label: "Last price", numeric: true },
  { key: "move", label: "30d", numeric: true },
  { key: "recipes", label: "Recipes", numeric: true },
]

const MODIFIER_COLUMNS: Column[] = [
  { key: "modifier", label: "Modifier" },
  { key: "sold", label: "Sold", numeric: true },
  { key: "price", label: "Price", numeric: true },
  { key: "maps", label: "Maps to" },
  { key: "state", label: "Cost" },
]

const PANTRY_COLUMNS: Column[] = [
  { key: "group", label: "Group" },
  { key: "items", label: "Items", numeric: true },
  { key: "costed", label: "Costed", numeric: true },
  { key: "spend", label: "Spend, 30d", numeric: true },
]

const ASK_SUGGESTIONS = [
  "Which ingredient prices moved most this month?",
  "How much do I buy that is in no recipe?",
  "Which invoice lines still match nothing?",
]

export function CounterIngredientsClient({
  params: paramsString,
  stores,
  today,
  sections,
}: {
  params: string
  stores: SwitchableStore[]
  today: Date
  sections: CounterIngredientsSections
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useMemo(() => new URLSearchParams(paramsString), [paramsString])
  const counterParams = useMemo(() => readCounterParams(params, today), [params, today])

  usePageChrome({ askSuggestions: ASK_SUGGESTIONS })

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

  return (
    <>
      <PageHead title="Ingredients" sub={`${storeName} · the catalogue and what it costs`}>
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

      <Section
        title="Price monitor"
        meta={(p) => p.meta}
        data={sections.prices}
        pending={pending}
        askAbout="which ingredient prices moved most this month"
      >
        {(p) => <Chart {...p.chart} fmt={PRICE} />}
      </Section>

      <div className="split">
        <Section
          title="Catalogue"
          meta={(c) => c.meta}
          data={sections.catalogue}
          pending={pending}
          pad={false}
        >
          {(c) => <Table columns={CATALOGUE_COLUMNS} rows={c.rows} />}
        </Section>

        <Section title="Review inbox" meta={(i) => i.meta} data={sections.inbox} pending={pending}>
          {(i) => (
            <>
              {i.clusters.map((c) => (
                <RowLine
                  key={c.key}
                  // The prototype's own override for this row: name, tag, two
                  // buttons. The sheet's default grid is the recipe editor's.
                  columns="minmax(0,1fr) 96px auto auto"
                  name={c.name}
                  sub={c.sub}
                >
                  <Tag tone={c.tone}>
                    {c.agreement} {c.agreement === 1 ? "way" : "ways"}
                  </Tag>
                  <Link className="btn" style={{ padding: "5px 11px" }} href="/dashboard/invoices">
                    The lines
                  </Link>
                  <Link
                    className="btn btn--quiet"
                    style={{ padding: "5px 9px" }}
                    href="/dashboard/ingredients"
                  >
                    Not one
                  </Link>
                </RowLine>
              ))}
              <p className="mono" style={{ margin: "11px 0 0" }}>
                {i.note}
              </p>
            </>
          )}
        </Section>

        <Section
          title="Modifier mapping"
          meta={(m) => m.meta}
          data={sections.modifiers}
          pending={pending}
          pad={false}
        >
          {(m) => <Table columns={MODIFIER_COLUMNS} rows={m.rows} />}
        </Section>
      </div>

      <div className="split">
        <Section
          title="Needs review"
          meta={(w) => w.meta}
          data={sections.work}
          pending={pending}
          askAbout="how much do I buy that is in no recipe"
        >
          {(w) => <Queue items={w.items} />}
        </Section>

        <Section
          title="The pantry"
          meta={(p) => p.meta}
          data={sections.pantry}
          pending={pending}
          pad={false}
        >
          {(p) => (
            <>
              <Table columns={PANTRY_COLUMNS} rows={p.rows} />
              {/* No `.sec__body` — a table section emits the table alone, so
                  the note carries the body's own inset inline. */}
              <p className="mono" style={{ margin: 0, padding: "13px 15px" }}>
                {p.note}
              </p>
            </>
          )}
        </Section>
      </div>
    </>
  )
}

/**
 * The axis is percent change, not dollars — the adapter indexes every series to
 * its own first reading, because ground beef at $4.39 a pound and house sauce
 * at $118.71 a case cannot share a dollar scale. The legend carries the native
 * price; this writes the movement.
 */
const PRICE = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`
