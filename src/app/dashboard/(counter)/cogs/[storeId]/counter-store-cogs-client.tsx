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
  Tag,
  useCounterTransition,
  usePageChrome,
  type Column,
  type Row,
  type SwitchableStore,
} from "@/components/counter"
import { readCounterParams, writeCounterParams } from "@/lib/counter/url-state"
import { pct } from "@/lib/counter/format"
import { rangeLabel, stepRange } from "@/lib/counter/date-range"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type {
  StoreCogsSections,
  MovedSection,
  WorstSection,
} from "@/lib/counter/adapters/cogs"

/**
 * One store's COGS, composed from `P.cogsstore.desk()`
 * (`docs/counter/counter-prototype.html:7744`) in the prototype's own order:
 *
 *   the store note → strip → the plan chart → the split of what moved and the
 *   worst-margin items.
 *
 * ## What this route has that the group page does not
 *
 * Four strip cells instead of three, and no category ring. The prototype's own
 * argument for the route is the plan line: *"against the COGS target that
 * store carries on its own file rather than the group average"*. The ring is
 * absent because it answers a question about the whole account's menu mix and
 * does not change per store — drawing it twice would be one figure claiming to
 * be two.
 *
 * ## The words are the adapter's
 *
 * Every sentence here is derived. `P.cogsstore` is written for a store OVER
 * its target — a cell reading "▲ N pts", a dollar figure captioned "of margin"
 * — and this store is 1.6 points INSIDE a published 30%. A page that says
 * "over" about a restaurant inside plan is worse than a page that says nothing
 * (C-R2), so nothing is ported.
 */
export type CounterStoreCogsSections = SectionSources<StoreCogsSections>

/** Same five columns the group page's table uses, so one movement reads one way. */
const MOVED_COLUMNS: Column[] = [
  { key: "ingredient", label: "Ingredient" },
  { key: "then", label: "Then", numeric: true },
  { key: "now", label: "Now", numeric: true },
  { key: "change", label: "Change", numeric: true },
  { key: "recipes", label: "Recipes", numeric: true },
]

const WORST_COLUMNS: Column[] = [
  { key: "item", label: "Item" },
  { key: "foodPct", label: "Food %", numeric: true },
  { key: "units", label: "Units", numeric: true },
  { key: "lost", label: "Lost vs plan", numeric: true },
]

function movedRows(m: MovedSection): Row[] {
  return m.rows.map((row) => ({
    key: row.key,
    cells: {
      ingredient: <b>{row.ingredient}</b>,
      then: row.then,
      now: row.now,
      change: <Tag tone={row.changeTone}>{row.change}</Tag>,
      recipes: row.recipes,
    },
  }))
}

function worstRows(w: WorstSection): Row[] {
  return w.rows.map((row) => ({
    key: row.key,
    cells: {
      item: <b>{row.item}</b>,
      foodPct: row.foodPct,
      units: row.units,
      // An item inside plan carries no tone and an em-dash, not a green zero:
      // it did not lose anything, which is different from losing nothing.
      lost: row.lostTone ? <Tag tone={row.lostTone}>{row.lost}</Tag> : row.lost,
    },
  }))
}

const PCT = (v: number) => pct(v, { scaled: true })

const ASK_SUGGESTIONS = [
  "Is this store inside its own food-cost target?",
  "Which ingredient prices moved this month?",
  "Which items lose the most against plan here?",
]

export function CounterStoreCogsClient({
  params: paramsString,
  storeId,
  stores,
  today,
  sections,
}: {
  params: string
  storeId: string
  stores: SwitchableStore[]
  today: Date
  sections: CounterStoreCogsSections
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useMemo(() => new URLSearchParams(paramsString), [paramsString])
  const counterParams = useMemo(() => readCounterParams(params, today), [params, today])

  // The PATH's store, not `counterParams.storeId` — `page.tsx` reconciled the
  // query string before this island ever rendered.
  const storeName = stores.find((s) => s.id === storeId)?.name ?? "This store"

  // `leaf`, `storeId` and `storeName` are all owed here. The layout's switcher
  // and breadcrumb read `?store=`, and this route carries none — without them
  // the crumb reads "All stores / COGS / COGS" on a page about one store, and
  // the switcher offers to change a store it does not know is selected.
  usePageChrome({
    leaf: storeName,
    storeId,
    storeName,
    askSuggestions: ASK_SUGGESTIONS,
  })

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
  const windowLabel = rangeLabel(range, "custom")

  return (
    <>
      <PageHead title="Cost of goods" sub={`${storeName} · ${windowLabel}`}>
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

      {/* The store note and the strip are ONE section, because the note is a
          statement about the figures beside it — a page that could show one
          without the other would print a claim about numbers that failed to
          load. Same shape as the P&L's headline. */}
      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => (
          <>
            {h.note ? (
              <p className="mono" style={{ margin: "0 0 13px" }}>
                {h.note}
              </p>
            ) : null}
            <Strip cells={h.cells} />
          </>
        )}
      </Section>

      <Section
        title="Food cost against this store's target"
        pending={pending}
        meta={(p) => p.meta}
        data={sections.plan}
        askAbout="how this store ran against its own food-cost target"
      >
        {(p) => (
          <>
            <Chart {...p.chart} fmt={PCT} />
            <p className="mono" style={{ margin: "9px 0 0" }}>
              {p.sentence}
            </p>
            <p className="mono" style={{ margin: "9px 0 0" }}>
              {p.note}
            </p>
          </>
        )}
      </Section>

      <div className="split">
        <Section
          title="What moved"
          pending={pending}
          meta={(m) => m.meta}
          data={sections.moved}
          pad={false}
          askAbout="which ingredient prices moved"
        >
          {(m) => (
            <>
              <Table columns={MOVED_COLUMNS} rows={movedRows(m)} />
              {/* No `.sec__body` wrapper: it is a landmark class and the
                  prototype's `sec(..., tbl(...))` emits the table alone. The
                  note carries the body's own inset inline instead of opening a
                  second landmark to get it. */}
              <p className="mono" style={{ margin: 0, padding: "13px 15px 0" }}>
                {m.sentence}
              </p>
              <p className="mono" style={{ margin: 0, padding: "9px 15px 13px" }}>
                {m.note}
              </p>
            </>
          )}
        </Section>

        <Section
          title="Worst margin items"
          pending={pending}
          meta={(w) => w.meta}
          data={sections.worst}
          pad={false}
          askAbout="which items lose the most against plan at this store"
        >
          {(w) => (
            <>
              <Table columns={WORST_COLUMNS} rows={worstRows(w)} />
              <p className="mono" style={{ margin: 0, padding: "13px 15px" }}>
                {w.note}
              </p>
            </>
          )}
        </Section>
      </div>
    </>
  )
}
