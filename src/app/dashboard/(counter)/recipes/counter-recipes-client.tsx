"use client"

import { useCallback, useMemo } from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  DateControl,
  PageHead,
  Queue,
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
import type { RecipesSections } from "@/lib/counter/adapters/recipes"

/**
 * Recipes, composed from `P.recipes.desk()`
 * (`docs/counter/counter-prototype.html:6110`) in the prototype's own order:
 *
 *   strip → all recipes → a split of the worklist and component recipes.
 *
 * The adapter's docblock argues the departures, and there are four. Two of the
 * prototype's strip cells count populations of size zero on this account
 * (nothing is AI-generated, nothing is uncosted in its sense); the `Yield`
 * column is sixty ones; and the queue leads with one named plate rather than a
 * tally, because a sellable slider declaring a $0.00 food cost is worth more
 * than a count of unconfirmed recipes. This file renders what it is handed and
 * prints each reason under the section it belongs to.
 */
export type CounterRecipesSections = SectionSources<RecipesSections>

const CATALOGUE_COLUMNS: Column[] = [
  { key: "recipe", label: "Recipe" },
  { key: "category", label: "Category" },
  { key: "cost", label: "Cost / serving", numeric: true },
  { key: "price", label: "Sells at", numeric: true },
  { key: "margin", label: "Margin", numeric: true },
  { key: "state", label: "State" },
]

const COMPONENT_COLUMNS: Column[] = [
  { key: "component", label: "Component" },
  { key: "cost", label: "Cost", numeric: true },
  { key: "usedIn", label: "Used in", numeric: true },
  { key: "also", label: "Also" },
]

const ASK_SUGGESTIONS = [
  "Which plates have no recipe lines at all?",
  "How much revenue sits on unconfirmed recipes?",
  "Which recipes are used inside other recipes?",
]

export function CounterRecipesClient({
  params: paramsString,
  stores,
  today,
  sections,
}: {
  params: string
  stores: SwitchableStore[]
  today: Date
  sections: CounterRecipesSections
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
  const storeName = stores.find((s) => s.id === counterParams.storeId)?.name ?? "All stores"

  return (
    <>
      <PageHead title="Recipes" sub={`${storeName} · what each plate is made of and what it costs`}>
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
        title="All recipes"
        meta={(c) => c.meta}
        data={sections.catalogue}
        pending={pending}
        pad={false}
        askAbout="which plates have no recipe lines at all"
      >
        {(c) => (
          <>
            <Table columns={CATALOGUE_COLUMNS} rows={c.rows} />
            {/* No `.sec__body` — a table section emits the table alone, so the
                note carries the body's own inset inline. */}
            <p className="mono" style={{ margin: 0, padding: "13px 15px" }}>
              {c.note}
            </p>
          </>
        )}
      </Section>

      <div className="split">
        <Section
          title="Needs confirming"
          meta={(w) => w.meta}
          data={sections.work}
          pending={pending}
          askAbout="how much revenue sits on unconfirmed recipes"
        >
          {(w) => <Queue items={w.items} />}
        </Section>

        <Section
          title="Component recipes"
          meta={(c) => c.meta}
          data={sections.components}
          pending={pending}
          pad={false}
        >
          {(c) => (
            <>
              <Table columns={COMPONENT_COLUMNS} rows={c.rows} />
              <p className="mono" style={{ margin: 0, padding: "13px 15px" }}>
                {c.note}
              </p>
            </>
          )}
        </Section>
      </div>
    </>
  )
}
